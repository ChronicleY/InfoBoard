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
import { parseBoardList, parseBoardDetail, parseInfolistPage, gbkEncodeUrl } from "../../modules/crawler/boardParser";
import { filterNewUrls, getArticleId } from "../../modules/crawler/deduplicator";
import { matchByKeywords } from "../../modules/classifier/keywordMatcher";
import { classifyWithLLM } from "../../modules/classifier/llmClassifier";
import { matchCompetition } from "../../modules/classifier/competitionMatcher";

export default defineBackground(() => {
  const BOARD_CATEGORIES = [
    "教务教学",
    "科研动态",
    "党务行政",
    "学生工作",
    "学术讲座",
    "校园生活",
  ];

  // Board sections to subscribe by default — matches the 6 panels on the main page
  const DEFAULT_SUBSCRIPTIONS = [
    "教务教学",
    "科研动态",
    "党务行政",
    "学生工作",
    "学术讲座",
    "校园生活",
  ];

  const BOARD_MAIN_URL = "https://www1.szu.edu.cn/board/";

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
      const subscriptions =
        settings.subscriptions.length > 0
          ? settings.subscriptions
          : BOARD_CATEGORIES;

      let allNewArticles: Article[] = [];

      // Step 1: Crawl the main board page (latest 10 per category)
      const mainDoc = await fetchBoardPage(BOARD_MAIN_URL);
      const mainPreviews = parseBoardList(mainDoc);
      const subscribedPreviews = mainPreviews.filter((p) =>
        subscriptions.includes(p.section),
      );

      // Step 2: Also crawl infolist first page for each subscribed category
      const infotypeMap: Record<string, string> = {
        "教务教学": "教务", "科研动态": "科研", "党务行政": "行政",
        "学生工作": "学工", "学术讲座": "讲座", "校园生活": "生活",
      };

      const allPreviews = [...subscribedPreviews];

      for (const section of subscriptions) {
        const infotype = infotypeMap[section];
        if (!infotype) continue;

        try {
          const encodedType = gbkEncodeUrl(infotype);
          const infolistUrl = `https://www1.szu.edu.cn/board/infolist.asp?infotype=${encodedType}`;
          const infolistDoc = await fetchBoardPage(infolistUrl);
          const infolistPreviews = parseInfolistPage(infolistDoc, section);
          // Limit to 20 per category from infolist to keep crawl manageable
          allPreviews.push(...infolistPreviews.slice(0, 20));
        } catch {
          // Infolist fetch failed — non-critical, continue with main page results
        }
      }

      const newPreviews = await filterNewUrls(allPreviews);

      // Step 3: Fetch detail pages and classify
      let ssoExpired = false;

      for (const preview of newPreviews) {
        try {
          const detailDoc = await fetchBoardPage(preview.url);
          const detail = parseBoardDetail(detailDoc);

          const id = getArticleId(preview.url);

          let category = "待分类";
          let matchedKeywords: string[] = [];
          let llmClassified = false;

          const keywordResult = matchByKeywords(
            preview.title,
            detail.summary,
            categories,
          );
          if (keywordResult) {
            category = keywordResult.category.name;
            matchedKeywords = keywordResult.matchedKeywords;
          } else if (settings.deepseekApiKey) {
            try {
              const tempArticle: Article = {
                id,
                title: preview.title,
                url: preview.url,
                section: preview.section,
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
            competitionMatch = matchCompetition(
              preview.title,
              detail.summary,
            );
          }

          const article: Article = {
            id,
            title: preview.title,
            url: preview.url,
            section: preview.section,
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
