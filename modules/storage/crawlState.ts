import type { CrawlState } from "../types";

const DEFAULT_CRAWL_STATE: CrawlState = {
  lastCrawlTime: null,
  lastCrawlStatus: "idle",
  lastCrawlError: null,
  newArticleCount: 0,
  totalArticleCount: 0,
};

export async function getCrawlState(): Promise<CrawlState> {
  const result = await chrome.storage.local.get("meta:crawlState");
  return { ...DEFAULT_CRAWL_STATE, ...(result["meta:crawlState"] || {}) };
}

export async function saveCrawlState(state: Partial<CrawlState>): Promise<void> {
  const current = await getCrawlState();
  await chrome.storage.local.set({ "meta:crawlState": { ...current, ...state } });
}
