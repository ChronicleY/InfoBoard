import { useState, useEffect, useCallback } from "react";
import type { CrawlState } from "../../../modules/types";

export function useCrawlStatus(onComplete?: () => void) {
  const [crawlState, setCrawlState] = useState<CrawlState>({
    lastCrawlTime: null,
    lastCrawlStatus: "idle",
    lastCrawlError: null,
    newArticleCount: 0,
    totalArticleCount: 0,
  });

  const refresh = useCallback(async () => {
    const res = await chrome.runtime.sendMessage({ type: "crawl:status" });
    if (res?.success) {
      setCrawlState(res.data as CrawlState);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startCrawl = useCallback(async () => {
    setCrawlState((prev) => ({ ...prev, lastCrawlStatus: "crawling" }));
    const res = await chrome.runtime.sendMessage({ type: "crawl:start" });
    if (res?.success) {
      setCrawlState(res.data as CrawlState);
      onComplete?.();
    } else {
      setCrawlState((prev) => ({
        ...prev,
        lastCrawlStatus: res.error === "SSO expired. Please log in to www1.szu.edu.cn." ? "sso_expired" : "error",
        lastCrawlError: res.error ?? null,
      }));
    }
  }, [onComplete]);

  const checkSSO = useCallback(async (): Promise<boolean> => {
    const res = await chrome.runtime.sendMessage({ type: "check:sso" });
    return res?.success ? (res.data as boolean) : false;
  }, []);

  return { crawlState, refresh, startCrawl, checkSSO };
}
