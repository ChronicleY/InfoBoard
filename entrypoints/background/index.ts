import { defineBackground } from "wxt/utils/define-background";
import type {
  Article,
  CrawlState,
  Message,
  MessageResponse,
} from "../../modules/types";
import { BUILTIN_CATEGORIES } from "../../modules/types";

import { getArticles, saveArticles, updateArticle, deleteArticles, upsertArticles } from "../../modules/storage/notices";
import { getSettings, saveSettings } from "../../modules/storage/settings";
import { getCrawlState, saveCrawlState } from "../../modules/storage/crawlState";
import { cleanupExpired } from "../../modules/storage/cleanup";
import {
  fetchBoardPage,
  SSOExpiredError,
  BoardRedirectError,
  checkSSO,
} from "../../modules/crawler/fetcher";
import {
  parseBoardList,
  parseBoardDetail,
  parseInfolistPage,
  gbkEncodeUrl,
  parsePreviewDate,
  isWithinDays,
  type ArticlePreview,
} from "../../modules/crawler/boardParser";
import { filterNewUrls, getArticleId, addToDeletedIds } from "../../modules/crawler/deduplicator";
import { classifyByRules, classifyArticle } from "../../modules/classifier/classifyArticle";
import { classifyWithLLM } from "../../modules/classifier/llmClassifier";

const BOARD_CATEGORIES = ["教务教学", "科研动态", "党务行政", "学生工作", "学术讲座", "校园生活"];
const BOARD_MAIN_URL = "https://www1.szu.edu.cn/board/";

const CRAWL_TIMEOUT_MS = 10 * 60 * 1000;
const DETAIL_CONCURRENCY = 4;
const SAVE_BATCH_SIZE = 12;
const SSO_ABORT_THRESHOLD = 6;
const INFOLIST_CAP = 30;
const DEFAULT_STORAGE_DAYS = 7;

const SSO_ERROR_MESSAGE = "SSO expired. Please log in to www1.szu.edu.cn.";
const SSO_ERROR_DETAIL = "登录已过期，请在浏览器中重新登录 www1.szu.edu.cn 后重试";

const infotypeMap: Record<string, string> = {
  "教务教学": "教务", "科研动态": "科研", "党务行政": "行政",
  "学生工作": "学工", "学术讲座": "讲座", "校园生活": "生活",
};

/**
 * How many days back to crawl. The saved-days setting drives this; an optional
 * build-time `WXT_CRAWL_DAYS` env value overrides it (useful for one-off
 * backfills without touching the UI).
 */
function resolveCrawlDays(storageDays: number): number {
  const envValue = import.meta.env.WXT_CRAWL_DAYS;
  const envDays = Number(envValue);
  if (Number.isFinite(envDays) && envDays > 0) return Math.floor(envDays);
  return storageDays > 0 ? storageDays : DEFAULT_STORAGE_DAYS;
}

function dedupeByArticleId(previews: ArticlePreview[]): ArticlePreview[] {
  const seen = new Set<string>();
  const out: ArticlePreview[] = [];
  for (const preview of previews) {
    const id = getArticleId(preview.url);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(preview);
  }
  return out;
}

export default defineBackground(() => {

  // === Message Router ===

  chrome.runtime.onMessage.addListener(
    (message: Message, _sender, sendResponse: (response: MessageResponse<unknown>) => void) => {
      handleMessage(message).then(sendResponse).catch((err) => {
        sendResponse({ success: false, error: String(err) });
      });
      return true;
    },
  );

  async function handleMessage(message: Message): Promise<MessageResponse<unknown>> {
    switch (message.type) {
      case "crawl:start":
        return crawlStart();
      case "crawl:status":
        return crawlStatus();
      case "notices:list": {
        const articles = await getArticles();
        let result = articles;
        if (message.category && message.category !== "all") {
          result = result.filter((a) => a.category === message.category);
        }
        if (message.search) {
          const q = message.search.toLowerCase();
          result = result.filter(
            (a) =>
              a.title.toLowerCase().includes(q) ||
              a.summary.toLowerCase().includes(q) ||
              a.publisher.toLowerCase().includes(q),
          );
        }
        return { success: true, data: result };
      }
      case "notice:update": {
        await updateArticle(message.id, message.changes);
        return { success: true, data: undefined };
      }
      case "notice:favorite": {
        await updateArticle(message.id, { favorite: message.favorite });
        return { success: true, data: undefined };
      }
      case "notices:cleanup": {
        const count = await cleanupExpired();
        return { success: true, data: count };
      }
      case "categories:list": {
        return { success: true, data: BUILTIN_CATEGORIES };
      }
      case "settings:get": {
        const settings = await getSettings();
        return { success: true, data: settings };
      }
      case "settings:save": {
        await saveSettings(message.settings);
        return { success: true, data: undefined };
      }
      case "notice:delete": {
        await deleteArticles([message.id]);
        await addToDeletedIds(message.id);
        return { success: true, data: undefined };
      }
      case "check:sso": {
        const ok = await checkSSO();
        return { success: true, data: ok };
      }
      default:
        return { success: false, error: "Unknown message type" };
    }
  }

  // === Re-classify existing articles ===

  // Uses the same pipeline as the crawler (classifyByRules + LLM fallback) so the
  // two can never drift apart.
  async function reclassifyExisting(): Promise<void> {
    const articles = await getArticles();
    const settings = await getSettings();

    let changed = 0;
    for (const article of articles) {
      if (article.manuallyClassified || article.llmClassified) continue;

      const rule = classifyByRules({
        title: article.title,
        summary: article.summary,
        publishDate: article.publishDate,
        publisher: article.publisher,
      });

      if (rule) {
        if (article.category !== rule.category) {
          article.category = rule.category;
          article.matchedKeywords = rule.matchedKeywords;
          article.llmClassified = false;
          changed++;
        }
        if (rule.competitionMatch && !article.competitionMatch) {
          article.competitionMatch = rule.competitionMatch;
          changed++;
        }
        continue;
      }

      if (article.category === "待分类" && !article.llmAttempted) {
        article.llmAttempted = true;
        changed++;
        if (settings.deepseekApiKey) {
          try {
            const llmCategory = await classifyWithLLM(article, settings.deepseekApiKey, BUILTIN_CATEGORIES);
            if (llmCategory !== "待分类") {
              article.category = llmCategory;
              article.matchedKeywords = [];
              article.llmClassified = true;
            }
          } catch { /* keep 待分类 */ }
        }
      }
    }

    if (changed > 0) {
      await saveArticles(articles);
      console.log(`[crawl] Re-classified ${changed} existing articles`);
    }
  }

  async function markSsoExpired(): Promise<MessageResponse<CrawlState>> {
    await saveCrawlState({
      lastCrawlStatus: "sso_expired",
      lastCrawlTime: Date.now(),
      lastCrawlError: SSO_ERROR_DETAIL,
    });
    return { success: false, error: SSO_ERROR_MESSAGE };
  }

  // === Crawl Orchestrator ===

  async function crawlStart(): Promise<MessageResponse<CrawlState>> {
    const current = await getCrawlState();
    // If the service worker died mid-crawl, the state stays "crawling" forever —
    // allow a restart once enough time has passed.
    const stale = current.lastCrawlStatus === "crawling"
      && (current.lastCrawlTime ?? 0) < Date.now() - CRAWL_TIMEOUT_MS;
    if (current.lastCrawlStatus === "crawling" && !stale) {
      return { success: false, error: "CRAWL_IN_PROGRESS" };
    }

    await saveCrawlState({
      lastCrawlStatus: "crawling",
      lastCrawlTime: Date.now(),
      lastCrawlError: null,
      newArticleCount: 0,
      processedCount: 0,
      totalCount: 0,
    });

    // Serialise every crawl-state write so concurrent workers cannot clobber
    // each other's read-modify-write.
    let stateChain: Promise<void> = Promise.resolve();
    const updateState = (partial: Partial<CrawlState>): Promise<void> => {
      stateChain = stateChain.then(() => saveCrawlState(partial));
      return stateChain;
    };

    try {
      await reclassifyExisting();

      const settings = await getSettings();
      const crawlDays = resolveCrawlDays(settings.storageDays);

      // Step 1: main board page — the authentication gate. Only a failure here
      // is treated as a real login problem.
      let mainHtml: string;
      try {
        console.log("[crawl] Fetching main board page:", BOARD_MAIN_URL);
        mainHtml = await fetchBoardPage(BOARD_MAIN_URL);
      } catch (err) {
        if (err instanceof SSOExpiredError || err instanceof BoardRedirectError) {
          return await markSsoExpired();
        }
        throw err;
      }

      const mainPreviews = parseBoardList(mainHtml).filter((p) =>
        BOARD_CATEGORIES.includes(p.section),
      );
      console.log(`[crawl] Main page: ${mainPreviews.length} subscribed articles`);

      // Step 2: infolist pages (best effort — one failure must not kill the crawl).
      const allPreviews: ArticlePreview[] = [...mainPreviews];
      for (const section of BOARD_CATEGORIES) {
        const infotype = infotypeMap[section];
        if (!infotype) continue;
        try {
          const infolistUrl = `https://www1.szu.edu.cn/board/infolist.asp?infotype=${gbkEncodeUrl(infotype)}`;
          const infolistHtml = await fetchBoardPage(infolistUrl);
          allPreviews.push(...parseInfolistPage(infolistHtml, section).slice(0, INFOLIST_CAP));
        } catch (err) {
          if (err instanceof SSOExpiredError) return await markSsoExpired();
          console.warn(`[crawl] Infolist fetch failed for ${section}:`, err);
        }
      }

      // Step 3: dedupe → keep the configured recency window → drop known ids.
      const deduped = dedupeByArticleId(allPreviews);
      const recent = deduped.filter((p) => isWithinDays(parsePreviewDate(p.dateStr), crawlDays));
      console.log(`[crawl] ${deduped.length} unique previews, ${recent.length} within ${crawlDays} days`);

      const newPreviews = await filterNewUrls(recent);
      console.log(`[crawl] ${newPreviews.length} new articles to fetch`);

      // Step 4: fetch details concurrently, persisting results in batches so the
      // popup can show them while the crawl is still running.
      const existingArticles = await getArticles();
      const existingMap = new Map(existingArticles.map((a) => [a.id, a]));

      let detailOk = 0;
      let detailFail = 0;
      let ssoHits = 0;
      let aborted = false;
      let processed = 0;
      let cursor = 0;
      let savedCount = 0;
      let lastProgressAt = 0;
      const pending: Article[] = [];
      let flushChain: Promise<void> = Promise.resolve();

      const flush = (force = false): Promise<void> => {
        if (pending.length === 0) return flushChain;
        if (!force && pending.length < SAVE_BATCH_SIZE) return flushChain;
        const batch = pending.splice(0, pending.length);
        flushChain = flushChain.then(async () => {
          for (const article of batch) existingMap.set(article.id, article);
          await upsertArticles(batch);
          savedCount += batch.length;
          await updateState({ newArticleCount: savedCount, totalArticleCount: existingMap.size });
        });
        return flushChain;
      };

      const reportProgress = async (force = false): Promise<void> => {
        const now = Date.now();
        if (!force && now - lastProgressAt < 1200) return;
        lastProgressAt = now;
        await updateState({ processedCount: processed, totalCount: newPreviews.length });
      };

      const worker = async (): Promise<void> => {
        while (!aborted) {
          const idx = cursor++;
          if (idx >= newPreviews.length) return;
          const preview = newPreviews[idx];

          try {
            const detailHtml = await fetchBoardPage(preview.url);
            const detail = parseBoardDetail(detailHtml);
            const id = getArticleId(preview.url);

            const classified = await classifyArticle(
              {
                title: preview.title,
                summary: detail.summary,
                publishDate: detail.publishDate,
                publisher: detail.publisher,
              },
              settings.deepseekApiKey,
            );

            pending.push({
              id,
              title: preview.title,
              url: preview.url,
              section: preview.section,
              publisher: detail.publisher,
              publishDate: detail.publishDate,
              location: detail.location,
              summary: detail.summary,
              category: classified.category,
              matchedKeywords: classified.matchedKeywords,
              llmClassified: classified.llmClassified,
              llmAttempted: classified.llmAttempted,
              competitionMatch: classified.competitionMatch,
              favorite: false,
              crawledAt: Date.now(),
            });
            detailOk++;
          } catch (err) {
            // A single bad/stale article (redirect, deleted post, …) must never
            // abort the whole crawl. Only repeated login failures stop it.
            if (err instanceof SSOExpiredError) {
              ssoHits++;
              if (ssoHits >= SSO_ABORT_THRESHOLD) aborted = true;
            }
            detailFail++;
          }

          processed++;
          await flush();
          await reportProgress();
        }
      };

      const workerCount = Math.min(DETAIL_CONCURRENCY, Math.max(1, newPreviews.length));
      await Promise.all(Array.from({ length: workerCount }, worker));
      await flush(true);
      await reportProgress(true);
      await flushChain;

      console.log(`[crawl] Details: ${detailOk} ok, ${detailFail} failed, ${savedCount} saved`);

      if (aborted) {
        // Session died partway; keep everything already persisted.
        await updateState({
          lastCrawlStatus: "sso_expired",
          lastCrawlTime: Date.now(),
          lastCrawlError: SSO_ERROR_DETAIL,
          newArticleCount: savedCount,
          totalArticleCount: existingMap.size,
        });
        return { success: false, error: SSO_ERROR_MESSAGE };
      }

      const status = detailFail > 0 && savedCount === 0
        ? "error" : detailFail > 0 ? "partial" : "success";

      let lastError: string | null = null;
      if (status === "error") lastError = `所有 ${detailFail} 篇文章抓取失败`;
      else if (status === "partial") lastError = `${detailFail} 篇文章详情抓取失败`;

      await updateState({
        lastCrawlTime: Date.now(),
        lastCrawlStatus: status,
        lastCrawlError: lastError,
        newArticleCount: savedCount,
        totalArticleCount: existingMap.size,
        processedCount: newPreviews.length,
        totalCount: newPreviews.length,
      });

      return { success: true, data: await getCrawlState() };
    } catch (err) {
      await saveCrawlState({ lastCrawlStatus: "error", lastCrawlError: String(err) });
      return { success: false, error: String(err) };
    }
  }

  async function crawlStatus(): Promise<MessageResponse<CrawlState>> {
    const state = await getCrawlState();
    return { success: true, data: state };
  }

  // === Cleanup Alarm ===

  chrome.alarms.create("daily-cleanup", { periodInMinutes: 1440 });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "daily-cleanup") {
      await cleanupExpired();
    }
  });

  // === Install handler ===

  chrome.runtime.onInstalled.addListener(async () => {
    const settings = await getSettings();
    await saveSettings(settings);
  });
});
