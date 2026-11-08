import { defineBackground } from "wxt/utils/define-background";
import type {
  Article,
  CategoryDef,
  CrawlState,
  Message,
  MessageResponse,
  ClassifierModel,
} from "../../modules/types";
import { BUILTIN_CATEGORIES } from "../../modules/types";
import { getClassifierTaxonomy, resolveActiveCategoryId, resolveCategoryId, saveClassifierCategories } from "../../modules/storage/taxonomy";

import { getArticle, getArticles, updateArticle, deleteArticles, upsertArticles } from "../../modules/storage/notices";
import { getSettings, saveSettings } from "../../modules/storage/settings";
import { getCrawlState, saveCrawlState } from "../../modules/storage/crawlState";
import { cleanupExpired } from "../../modules/storage/cleanup";
import {
  commitRollback,
  commitTrainedModel,
  getClassifierState,
  getClassifierStatus,
  getExportData,
  getLatestTrainingExamples,
  importClassifierLabelsCsv,
  initializeClassifierModel,
  recordManualLabel,
} from "../../modules/storage/classifier";
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
import { matchCompetition } from "../../modules/classifier/competitionMatcher";
import type { ClassificationResult, ClassifierText } from "../../modules/classifier/naiveBayes";
import type { ClassifierTask, ClassifierWorkerRequest, ClassifierWorkerResponse } from "../../modules/classifier/workerProtocol";

const BOARD_CATEGORIES = ["教务教学", "科研动态", "党务行政", "学生工作", "学术讲座", "校园生活"];
const BOARD_MAIN_URL = "https://www1.szu.edu.cn/board/";

const CRAWL_TIMEOUT_MS = 10 * 60 * 1000;
const DETAIL_CONCURRENCY = 4;
const SAVE_BATCH_SIZE = 12;
const SSO_ABORT_THRESHOLD = 6;
const INFOLIST_CAP = 30;
const DEFAULT_STORAGE_DAYS = 7;
const LEGACY_MIGRATION_KEY = "meta:classifierLegacyMigrationV1";
const OFFSCREEN_TARGET = "classifier-offscreen";
const CLASSIFIER_TIMEOUT_MS = 120_000;

let offscreenCreation: Promise<void> | null = null;
let classifierSetup: Promise<ClassifierModel> | null = null;
let activeClassifierJob: "crawl" | "train" | "rollback" | "taxonomy" | null = null;

async function withClassifierJob<T>(
  job: "crawl" | "train" | "rollback" | "taxonomy",
  operation: () => Promise<MessageResponse<T>>,
): Promise<MessageResponse<T>> {
  if (activeClassifierJob) {
    return { success: false, error: `${activeClassifierJob.toUpperCase()}_IN_PROGRESS` };
  }
  activeClassifierJob = job;
  try {
    return await operation();
  } finally {
    activeClassifierJob = null;
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  if (!offscreenCreation) {
    offscreenCreation = (async () => {
      const url = chrome.runtime.getURL("offscreen.html");
      const existing = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [url],
      });
      if (existing.length > 0) return;
      try {
        await chrome.offscreen.createDocument({
          url: "offscreen.html",
          reasons: ["WORKERS"],
          justification: "Run local article classification in a Web Worker.",
        });
      } catch (error) {
        const contexts = await chrome.runtime.getContexts({
          contextTypes: ["OFFSCREEN_DOCUMENT"],
          documentUrls: [url],
        });
        if (contexts.length === 0) throw error;
      }
    })();
  }
  try {
    await offscreenCreation;
  } finally {
    offscreenCreation = null;
  }
}

async function runClassifierTask(task: ClassifierTask): Promise<ClassifierWorkerResponse["result"]> {
  await ensureOffscreenDocument();
  const request: ClassifierWorkerRequest & { target: string } = {
    id: crypto.randomUUID(),
    task,
    target: OFFSCREEN_TARGET,
  };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage(request) as Promise<ClassifierWorkerResponse>,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Classifier Worker timed out")), CLASSIFIER_TIMEOUT_MS);
      }),
    ]);
    if (!response?.success) throw new Error(response?.error ?? "Classifier Worker failed");
    return response.result;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function toClassifierText(article: Article): ClassifierText {
  return {
    title: article.title,
    summary: article.summary,
    section: article.section,
    publisher: article.publisher,
    location: article.location,
    publishDate: article.publishDate,
    bodyText: article.bodyText,
    eventTime: article.eventTime,
    eventDate: article.eventDate,
    updatedAt: article.updatedAt,
    topic: article.topic,
    titleAttributes: article.titleAttributes,
  };
}

async function classifyBatch(
  articles: Article[],
  model: ClassifierModel,
  taxonomy: Awaited<ReturnType<typeof getClassifierTaxonomy>>,
): Promise<Array<{ articleId: string; result: ClassificationResult }>> {
  const results: Array<{ articleId: string; result: ClassificationResult }> = [];
  for (let start = 0; start < articles.length; start += 80) {
    const batch = articles.slice(start, start + 80);
    const response = await runClassifierTask({
      type: "classify-batch",
      articles: batch.map(toClassifierText),
      model,
    });
    if (!Array.isArray(response)) throw new Error("Classifier Worker returned an invalid batch result");
    response.forEach((rawResult, index) => {
      const categoryId = resolveActiveCategoryId(
        rawResult.categoryId ?? model.categories.find((category) => category.name === rawResult.category)?.id ?? "other",
        taxonomy,
      );
      const category = taxonomy.categories.find((item) => item.id === categoryId) ?? taxonomy.categories.find((item) => item.id === "other")!;
      results.push({
        articleId: batch[index].id,
        result: { ...rawResult, category: category.name, categoryId: category.id } as ClassificationResult,
      });
    });
  }
  return results;
}

function legacyManualCategory(category: string): string | null {
  const legacyIds: Record<string, string> = {
    "\u8bb2\u5ea7": "lecture",
    "\u6bd4\u8d5b": "competition",
    "\u6559\u52a1": "academic",
    "\u79d1\u7814": "research",
    "\u65b0\u95fb": "news",
    "\u751f\u6d3b": "campus-life",
  };
  const id = legacyIds[category];
  return id ? BUILTIN_CATEGORIES.find((item) => item.id === id)?.name ?? null : null;
}

async function migrateLegacyArticles(model: ClassifierModel, taxonomy: Awaited<ReturnType<typeof getClassifierTaxonomy>>): Promise<void> {
  const marker = await chrome.storage.local.get(LEGACY_MIGRATION_KEY);
  if (marker[LEGACY_MIGRATION_KEY]) return;

  const articles = await getArticles();
  const needsPrediction = articles.filter((article) => !article.manuallyClassified);
  const predictions = new Map((await classifyBatch(needsPrediction, model, taxonomy)).map((item) => [item.articleId, item.result]));
  const categoryById = new Map(taxonomy.categories.map((category) => [category.id, category]));

  for (const article of articles) {
    if (article.manuallyClassified) {
      const category = categoryById.get(article.categoryId ?? "")?.name ?? legacyManualCategory(article.category);
      if (category) {
        const categoryId = resolveCategoryId(category, taxonomy);
        await recordManualLabel(article.id, taxonomy.categories.find((item) => item.id === categoryId)?.name ?? "其他", "legacy-manual", true, categoryId);
        continue;
      }
    }
    const result = predictions.get(article.id);
    if (!result) continue;
    await updateArticle(article.id, {
      category: result.category,
      categoryId: result.categoryId,
      matchedKeywords: result.matchedKeywords,
      classificationConfidence: result.confidence,
      needsReview: result.needsReview,
      manuallyClassified: false,
    });
  }
  await chrome.storage.local.set({ [LEGACY_MIGRATION_KEY]: true });
}

async function ensureClassifierReady(): Promise<ClassifierModel> {
  if (!classifierSetup) {
    classifierSetup = (async () => {
      const taxonomy = await getClassifierTaxonomy();
      const state = await getClassifierState();
      let model = state.current;
      if (!model) {
        const result = await runClassifierTask({ type: "bootstrap", categories: taxonomy.categories });
        if (!result || Array.isArray(result) || "category" in result) {
          throw new Error("Classifier Worker returned an invalid bootstrap model");
        }
        model = await initializeClassifierModel(result as ClassifierModel);
      }
      await migrateLegacyArticles(model, taxonomy);
      return model;
    })();
  }
  try {
    return await classifierSetup;
  } finally {
    classifierSetup = null;
  }
}

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

function findActiveCategory(value: string, taxonomy: Awaited<ReturnType<typeof getClassifierTaxonomy>>): CategoryDef | null {
  return taxonomy.categories.find((category) => category.id === value)
    ?? taxonomy.categories.find((category) => category.name === value)
    ?? taxonomy.categories.find((category) => category.aliases?.includes(value))
    ?? null;
}

export default defineBackground(() => {

  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
    console.error("Unable to configure the side panel action:", error);
  });

  // === Message Router ===

  chrome.runtime.onMessage.addListener(
    (message: Message, _sender, sendResponse: (response: MessageResponse<unknown>) => void) => {
      if ((message as unknown as { target?: string }).target === OFFSCREEN_TARGET) return undefined;
      handleMessage(message).then(sendResponse).catch((err) => {
        sendResponse({ success: false, error: String(err) });
      });
      return true;
    },
  );

  async function handleMessage(message: Message): Promise<MessageResponse<unknown>> {
    switch (message.type) {
      case "crawl:start":
        return withClassifierJob("crawl", crawlStartLocked);
      case "crawl:status":
        return crawlStatus();
      case "notices:list": {
        await ensureClassifierReady();
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
              a.publisher.toLowerCase().includes(q) ||
              (a.bodyText ?? "").toLowerCase().includes(q),
          );
        }
        return { success: true, data: result };
      }
      case "notice:update": {
        const { category, categoryId: _categoryId, ...changes } = message.changes;
        if (category !== undefined) {
          await ensureClassifierReady();
          const taxonomy = await getClassifierTaxonomy();
          const target = findActiveCategory(category, taxonomy);
          if (!target) {
            return { success: false, error: "Unknown category" };
          }
          await recordManualLabel(message.id, target.name, "popup", false, target.id);
        }
        if (Object.keys(changes).length > 0) await updateArticle(message.id, changes);
        return { success: true, data: undefined };
      }
      case "notice:label": {
        await ensureClassifierReady();
        const taxonomy = await getClassifierTaxonomy();
        const category = findActiveCategory(message.categoryId ?? message.category, taxonomy);
        if (!category) return { success: false, error: "Unknown category" };
        if (!await getArticle(message.id)) return { success: false, error: "Article no longer available" };
        const changed = await recordManualLabel(message.id, category.name, "popup", false, category.id);
        return { success: true, data: { changed, status: await getClassifierStatus() } };
      }
      case "classifier:status": {
        await ensureClassifierReady();
        return { success: true, data: await getClassifierStatus() };
      }
      case "classifier:train": {
        return withClassifierJob("train", trainClassifierModel);
      }
      case "classifier:rollback": {
        return withClassifierJob("rollback", rollbackClassifierModel);
      }
      case "classifier:export": {
        await ensureClassifierReady();
        return { success: true, data: await getExportData() };
      }
      case "classifier:import-labels": {
        await ensureClassifierReady();
        const result = await importClassifierLabelsCsv(message.csv);
        return { success: true, data: { ...result, status: await getClassifierStatus() } };
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
        await ensureClassifierReady();
        return { success: true, data: await getClassifierTaxonomy() };
      }
      case "categories:save": {
        return withClassifierJob("taxonomy", async () => {
          await ensureClassifierReady();
          const taxonomy = await saveClassifierCategories(message.categories as CategoryDef[], message.expectedRevision);
          return { success: true, data: taxonomy };
        });
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

  async function trainClassifierModel(): Promise<MessageResponse<unknown>> {
    const currentModel = await ensureClassifierReady();
    const taxonomy = await getClassifierTaxonomy();
    const before = await getClassifierState();
    const latestLabels = await getLatestTrainingExamples();
    if (latestLabels.length === 0) {
      return { success: false, error: "No manual category labels to train from" };
    }
    const examples = latestLabels.map((record) => ({
      articleId: record.articleId,
      labelRecordId: record.id,
      category: record.category,
      categoryId: resolveActiveCategoryId(record.categoryId ?? resolveCategoryId(record.category, taxonomy), taxonomy),
      article: record.article,
    }));
    const modelResult = await runClassifierTask({
      type: "train",
      examples,
      version: currentModel.version + 1,
      categories: taxonomy.categories,
      retiredCategoryIds: taxonomy.retiredCategoryIds,
    });
    if (!modelResult || Array.isArray(modelResult) || "category" in modelResult) {
      throw new Error("Classifier Worker returned an invalid trained model");
    }
    const model = modelResult as ClassifierModel;
    const articles = await getArticles();
    const predictions = await classifyBatch(articles, model, taxonomy);
    const reclassified = await commitTrainedModel(
      model,
      before.feedbackRevision,
      currentModel.version,
      predictions,
      taxonomy.revision,
    );
    return {
      success: true,
      data: { status: await getClassifierStatus(), reclassified },
    };
  }

  async function rollbackClassifierModel(): Promise<MessageResponse<unknown>> {
    const currentModel = await ensureClassifierReady();
    const taxonomy = await getClassifierTaxonomy();
    const state = await getClassifierState();
    if (!state.previous) return { success: false, error: "No previous classifier model to restore" };
    const articles = await getArticles();
    const predictions = await classifyBatch(articles, state.previous, taxonomy);
    const result = await commitRollback(currentModel.version, state.previous.version, predictions, taxonomy.revision);
    return {
      success: true,
      data: { status: await getClassifierStatus(), reclassified: result.changed },
    };
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

  async function crawlStartLocked(): Promise<MessageResponse<CrawlState>> {
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
      const model = await ensureClassifierReady();
      const taxonomy = await getClassifierTaxonomy();

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

            const classification = await runClassifierTask({
              type: "classify",
              article: {
                title: preview.title,
                summary: detail.summary,
                bodyText: detail.bodyText,
                section: preview.section,
                publisher: detail.publisher,
                location: detail.location ?? preview.location ?? null,
                publishDate: detail.publishDate,
                eventTime: preview.eventTime ?? null,
                eventDate: detail.eventDate,
                updatedAt: detail.updatedAt,
                topic: preview.topic ?? null,
                titleAttributes: preview.titleAttributes ?? null,
              },
              model,
            });
            if (!classification || Array.isArray(classification) || !("category" in classification)) {
              throw new Error("Classifier Worker returned an invalid article result");
            }
            const rawClassified = classification as ClassificationResult;
            const activeCategoryId = resolveActiveCategoryId(rawClassified.categoryId ?? "other", taxonomy);
            const activeCategory = taxonomy.categories.find((category) => category.id === activeCategoryId)
              ?? taxonomy.categories.find((category) => category.id === "other")!;
            const classified = { ...rawClassified, category: activeCategory.name, categoryId: activeCategory.id };
            const competitionCategory = model.categories.find((category) => category.id === "competition")?.name;

            pending.push({
              id,
              title: preview.title,
              url: preview.url,
              section: preview.section,
              publisher: detail.publisher,
              publishDate: detail.publishDate,
              location: detail.location ?? preview.location ?? null,
              summary: detail.summary,
              bodyText: detail.bodyText,
              eventTime: preview.eventTime ?? null,
              eventDate: detail.eventDate,
              updatedAt: detail.updatedAt,
              topic: preview.topic ?? null,
              titleAttributes: preview.titleAttributes ?? null,
              category: classified.category,
              categoryId: classified.categoryId,
              matchedKeywords: classified.matchedKeywords,
              classificationConfidence: classified.confidence,
              needsReview: classified.needsReview,
              manuallyClassified: false,
              competitionMatch: classified.category === competitionCategory
                ? matchCompetition(preview.title, detail.summary)
                : null,
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
