import { defineBackground } from "wxt/utils/define-background";
import type {
  Article,
  CrawlState,
  Message,
  MessageResponse,
} from "../../modules/types";

import { getArticles, saveArticles, updateArticle, getArticleIds } from "../../modules/storage/notices";
import { getCategories, saveCustomCategories, saveBuiltinKeywords } from "../../modules/storage/categories";
import { getSettings, saveSettings } from "../../modules/storage/settings";
import { getCrawlState, saveCrawlState } from "../../modules/storage/crawlState";
import { cleanupExpired } from "../../modules/storage/cleanup";
import { fetchBoardPage, SSOExpiredError, checkSSO } from "../../modules/crawler/fetcher";
import { parseBoardList, parseBoardDetail } from "../../modules/crawler/boardParser";
import { filterNewUrls, getArticleId } from "../../modules/crawler/deduplicator";
import { matchByKeywords } from "../../modules/classifier/keywordMatcher";
import { classifyWithLLM } from "../../modules/classifier/llmClassifier";
import { matchCompetition } from "../../modules/classifier/competitionMatcher";

export default defineBackground(() => {
  const SUBSCRIPTION_SECTIONS = ["学生事务", "荔园生活", "教师事务", "网上服务"];

  const BOARD_URLS: Record<string, string> = {
    "学生事务": "https://www1.szu.edu.cn/board/",
    "荔园生活": "https://www1.szu.edu.cn/board/",
    "教师事务": "https://www1.szu.edu.cn/board/",
    "网上服务": "https://www1.szu.edu.cn/board/",
  };

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
        const categories = await getCategories();
        return { success: true, data: categories };
      }
      case "categories:save": {
        const { categories } = message;
        const builtins = categories.filter((c) => c.isBuiltin);
        const custom = categories.filter((c) => !c.isBuiltin);

        await saveCustomCategories(custom);

        const kwMap: Record<string, string[]> = {};
        for (const b of builtins) {
          if (b.id !== "uncategorized") {
            kwMap[b.id] = b.keywords;
          }
        }
        await saveBuiltinKeywords(kwMap);

        return { success: true, data: undefined };
      }
      case "settings:get": {
        const settings = await getSettings();
        return { success: true, data: settings };
      }
      case "settings:save": {
        await saveSettings(message.settings);
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

  // === Crawl Orchestrator ===

  async function crawlStart(): Promise<MessageResponse<CrawlState>> {
    const current = await getCrawlState();
    if (current.lastCrawlStatus === "crawling") {
      return { success: false, error: "Crawl already in progress" };
    }

    await saveCrawlState({ lastCrawlStatus: "crawling", lastCrawlError: null });

    try {
      const settings = await getSettings();
      const categories = await getCategories();
      const subscriptions = settings.subscriptions.length > 0 ? settings.subscriptions : SUBSCRIPTION_SECTIONS;

      let allNewArticles: Article[] = [];
      let ssoExpired = false;

      for (const section of subscriptions) {
        try {
          const boardUrl = BOARD_URLS[section];
          const doc = await fetchBoardPage(boardUrl);

          const previews = parseBoardList(doc, section);
          const newPreviews = await filterNewUrls(previews);

          for (const preview of newPreviews) {
            try {
              const detailDoc = await fetchBoardPage(preview.url);
              const detail = parseBoardDetail(detailDoc);

              const id = getArticleId(preview.url);

              let category = "待分类";
              let matchedKeywords: string[] = [];
              let llmClassified = false;

              const keywordResult = matchByKeywords(preview.title, detail.summary, categories);
              if (keywordResult) {
                category = keywordResult.category.name;
                matchedKeywords = keywordResult.matchedKeywords;
              } else if (settings.deepseekApiKey) {
                try {
                  const tempArticle: Article = {
                    id,
                    title: preview.title,
                    url: preview.url,
                    section,
                    publisher: detail.publisher,
                    publishDate: detail.publishDate,
                    location: detail.location,
                    summary: detail.summary,
                    category: "待分类",
                    matchedKeywords: [],
                    llmClassified: false,
                    competitionMatch: null,
                    favorite: false,
                    crawledAt: Date.now(),
                    isRead: false,
                  };
                  category = await classifyWithLLM(
                    tempArticle,
                    settings.deepseekApiKey,
                    settings.deepseekModel,
                    categories,
                  );
                  llmClassified = true;
                } catch {
                  // LLM failed, stay "待分类"
                }
              }

              let competitionMatch: string | null = null;
              if (category === "比赛") {
                competitionMatch = matchCompetition(preview.title, detail.summary);
              }

              const article: Article = {
                id,
                title: preview.title,
                url: preview.url,
                section,
                publisher: detail.publisher,
                publishDate: detail.publishDate,
                location: detail.location,
                summary: detail.summary,
                category,
                matchedKeywords,
                llmClassified,
                competitionMatch,
                favorite: false,
                crawledAt: Date.now(),
                isRead: false,
              };

              allNewArticles.push(article);
            } catch (err) {
              if (err instanceof SSOExpiredError) {
                ssoExpired = true;
                break;
              }
            }
          }
        } catch (err) {
          if (err instanceof SSOExpiredError) {
            ssoExpired = true;
            break;
          }
        }
      }

      if (ssoExpired) {
        await saveCrawlState({
          lastCrawlStatus: "sso_expired",
          lastCrawlTime: Date.now(),
          lastCrawlError: "登录已过期，请在浏览器中重新登录 www1.szu.edu.cn 后重试",
        });
        return {
          success: false,
          error: "SSO expired. Please log in to www1.szu.edu.cn.",
        };
      }

      const existingArticles = await getArticles();
      const existingMap = new Map(existingArticles.map((a) => [a.id, a]));

      for (const article of allNewArticles) {
        existingMap.set(article.id, article);
      }

      const allArticles = [...existingMap.values()];
      await saveArticles(allArticles);

      await saveCrawlState({
        lastCrawlTime: Date.now(),
        lastCrawlStatus: "success",
        lastCrawlError: null,
        newArticleCount: allNewArticles.length,
        totalArticleCount: allArticles.length,
      });

      const state = await getCrawlState();
      return { success: true, data: state };
    } catch (err) {
      await saveCrawlState({
        lastCrawlStatus: "error",
        lastCrawlError: String(err),
      });
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
