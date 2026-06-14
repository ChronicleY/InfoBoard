import { defineBackground } from "wxt/utils/define-background";
import type {
  Article,
  CrawlState,
  Message,
  MessageResponse,
} from "../../modules/types";
import { BUILTIN_CATEGORIES } from "../../modules/types";

import { getArticles, saveArticles, updateArticle, deleteArticles } from "../../modules/storage/notices";
import { getSettings, saveSettings } from "../../modules/storage/settings";
import { getCrawlState, saveCrawlState } from "../../modules/storage/crawlState";
import { cleanupExpired } from "../../modules/storage/cleanup";
import { fetchBoardPage, SSOExpiredError, checkSSO } from "../../modules/crawler/fetcher";
import { parseBoardList, parseBoardDetail, parseInfolistPage, gbkEncodeUrl } from "../../modules/crawler/boardParser";
import { filterNewUrls, getArticleId, addToDeletedIds } from "../../modules/crawler/deduplicator";
import { matchByKeywords, matchNewsKeywords } from "../../modules/classifier/keywordMatcher";
import { classifyWithLLM } from "../../modules/classifier/llmClassifier";
import { matchCompetition } from "../../modules/classifier/competitionMatcher";

const BOARD_CATEGORIES = ["教务教学", "科研动态", "党务行政", "学生工作", "学术讲座", "校园生活"];
const BOARD_MAIN_URL = "https://www1.szu.edu.cn/board/";

const infotypeMap: Record<string, string> = {
  "教务教学": "教务", "科研动态": "科研", "党务行政": "行政",
  "学生工作": "学工", "学术讲座": "讲座", "校园生活": "生活",
};

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

  async function reclassifyExisting(): Promise<void> {
    const articles = await getArticles();
    const settings = await getSettings();

    let changed = 0;
    for (const article of articles) {
      if (article.manuallyClassified || article.llmClassified) continue;

      // 公示 priority — runs before 新闻
      const publicNoticeResult = matchNamedCategory(article.title, article.summary, "公示");
      if (publicNoticeResult) {
        if (article.category !== "公示") {
          article.category = "公示";
          article.matchedKeywords = publicNoticeResult;
          article.llmClassified = false;
          changed++;
        }
        continue;
      }

      const newsMatches = matchNewsKeywords(article.title, article.summary, article.publishDate);
      if (newsMatches) {
        if (article.category !== "新闻") {
          article.category = "新闻";
          article.matchedKeywords = newsMatches;
          article.llmClassified = false;
          changed++;
        }
        continue;
      }

      const keywordResult = matchByKeywords(article.title, article.summary, BUILTIN_CATEGORIES);
      if (keywordResult) {
        const newCategory = keywordResult.category.name;
        if (article.category !== newCategory) {
          article.category = newCategory;
          article.matchedKeywords = keywordResult.matchedKeywords;
          article.llmClassified = false;
          changed++;
        }
        if (newCategory === "比赛" && !article.competitionMatch) {
          article.competitionMatch = matchCompetition(article.title, article.summary);
          if (article.competitionMatch) changed++;
        }
        continue;
      }

      // Try LLM for uncategorized articles (once only)
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

  // === Crawl Orchestrator ===

  async function crawlStart(): Promise<MessageResponse<CrawlState>> {
    const current = await getCrawlState();
    if (current.lastCrawlStatus === "crawling") {
      return { success: false, error: "Crawl already in progress" };
    }

    await saveCrawlState({ lastCrawlStatus: "crawling", lastCrawlError: null });

    try {
      await reclassifyExisting();

      const settings = await getSettings();

      let allNewArticles: Article[] = [];

      // Step 1: Crawl main board page
      console.log("[crawl] Fetching main board page:", BOARD_MAIN_URL);
      const mainDoc = await fetchBoardPage(BOARD_MAIN_URL);
      const mainPreviews = parseBoardList(mainDoc);
      console.log(`[crawl] Main page: ${mainPreviews.length} articles`);

      const subscribedPreviews = mainPreviews.filter((p) =>
        BOARD_CATEGORIES.includes(p.section),
      );
      console.log(`[crawl] Subscribed: ${subscribedPreviews.length} articles`);

      // Step 2: Crawl infolist for each category
      const allPreviews = [...subscribedPreviews];

      for (const section of BOARD_CATEGORIES) {
        const infotype = infotypeMap[section];
        if (!infotype) continue;

        try {
          const encodedType = gbkEncodeUrl(infotype);
          const infolistUrl = `https://www1.szu.edu.cn/board/infolist.asp?infotype=${encodedType}`;
          console.log(`[crawl] Fetching infolist for ${section}...`);
          const infolistDoc = await fetchBoardPage(infolistUrl);
          const infolistPreviews = parseInfolistPage(infolistDoc, section);
          console.log(`[crawl] Infolist ${section}: ${infolistPreviews.length} articles`);
          allPreviews.push(...infolistPreviews.slice(0, 20));
        } catch (err) {
          console.warn(`[crawl] Infolist fetch failed for ${section}:`, err);
        }
      }

      console.log(`[crawl] Total previews to check: ${allPreviews.length}`);

      const newPreviews = await filterNewUrls(allPreviews);

      // Step 3: Fetch detail pages and classify
      let ssoExpired = false;
      let detailOk = 0;
      let detailFail = 0;

      for (const preview of newPreviews) {
        try {
          const detailDoc = await fetchBoardPage(preview.url);
          const detail = parseBoardDetail(detailDoc);

          const id = getArticleId(preview.url);

          let category = "待分类";
          let matchedKeywords: string[] = [];
          let llmClassified = false;
          let llmAttempted = false;

          // 公示 priority
          const publicNoticeResult = matchNamedCategory(preview.title, detail.summary, "公示");
          if (publicNoticeResult) {
            category = "公示";
            matchedKeywords = publicNoticeResult;
          } else {
            const newsMatches = matchNewsKeywords(preview.title, detail.summary, detail.publishDate);
            if (newsMatches) {
              category = "新闻";
              matchedKeywords = newsMatches;
            } else {
              const keywordResult = matchByKeywords(preview.title, detail.summary, BUILTIN_CATEGORIES);
              if (keywordResult) {
                category = keywordResult.category.name;
                matchedKeywords = keywordResult.matchedKeywords;
              }
            }
          }

          // LLM fallback
          if (category === "待分类" && settings.deepseekApiKey) {
            llmAttempted = true;
            try {
              const tempArticle: Article = {
                id, title: preview.title, url: preview.url,
                section: preview.section, publisher: detail.publisher,
                publishDate: detail.publishDate, location: detail.location,
                summary: detail.summary, category: "待分类",
                matchedKeywords: [], llmClassified: false,
                competitionMatch: null, favorite: false, crawledAt: Date.now(),
              };
              const llmCategory = await classifyWithLLM(tempArticle, settings.deepseekApiKey, BUILTIN_CATEGORIES);
              if (llmCategory !== "待分类") {
                category = llmCategory;
                llmClassified = true;
              }
            } catch { /* stay 待分类 */ }
          }

          const competitionMatch = category === "比赛"
            ? matchCompetition(preview.title, detail.summary)
            : null;

          const article: Article = {
            id, title: preview.title, url: preview.url,
            section: preview.section, publisher: detail.publisher,
            publishDate: detail.publishDate, location: detail.location,
            summary: detail.summary, category, matchedKeywords,
            llmClassified, llmAttempted, competitionMatch,
            favorite: false, crawledAt: Date.now(),
          };

          allNewArticles.push(article);
          detailOk++;
        } catch (err) {
          if (err instanceof SSOExpiredError) {
            ssoExpired = true;
            break;
          }
          detailFail++;
          console.error(`[crawl] Detail fetch failed for ${preview.url}:`, err);
        }
      }

      console.log(`[crawl] Detail results: ${detailOk} ok, ${detailFail} failed`);

      if (ssoExpired) {
        await saveCrawlState({
          lastCrawlStatus: "sso_expired", lastCrawlTime: Date.now(),
          lastCrawlError: "登录已过期，请在浏览器中重新登录 www1.szu.edu.cn 后重试",
        });
        return { success: false, error: "SSO expired. Please log in to www1.szu.edu.cn." };
      }

      console.log(`[crawl] Saving ${allNewArticles.length} new articles`);

      const existingArticles = await getArticles();
      const existingMap = new Map(existingArticles.map((a) => [a.id, a]));
      for (const article of allNewArticles) {
        existingMap.set(article.id, article);
      }
      await saveArticles([...existingMap.values()]);

      const status = detailFail > 0 && allNewArticles.length === 0
        ? "error" : detailFail > 0 ? "partial" : "success";

      let lastError = null;
      if (status === "error") lastError = `所有 ${detailFail} 篇文章抓取失败`;
      else if (status === "partial") lastError = `${detailFail} 篇文章详情抓取失败`;

      await saveCrawlState({
        lastCrawlTime: Date.now(), lastCrawlStatus: status,
        lastCrawlError: lastError, newArticleCount: allNewArticles.length,
        totalArticleCount: existingMap.size,
      });

      const state = await getCrawlState();
      return { success: true, data: state };
    } catch (err) {
      await saveCrawlState({ lastCrawlStatus: "error", lastCrawlError: String(err) });
      return { success: false, error: String(err) };
    }
  }

  function matchNamedCategory(
    title: string,
    summary: string,
    name: string,
  ): string[] | null {
    const category = BUILTIN_CATEGORIES.find((c) => c.name === name);
    if (!category) return null;
    const text = `${title} ${summary}`.toLowerCase();
    const matched = category.keywords.filter((kw) => text.includes(kw.toLowerCase()));
    return matched.length > 0 ? matched : null;
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
