import { useState, useEffect, useCallback, useRef } from "react";
import type { CrawlState } from "../../../modules/types";

const EMPTY_STATE: CrawlState = {
  lastCrawlTime: null,
  lastCrawlStatus: "idle",
  lastCrawlError: null,
  newArticleCount: 0,
  totalArticleCount: 0,
  processedCount: 0,
  totalCount: 0,
};

const SSO_ERROR = "SSO expired. Please log in to www1.szu.edu.cn.";

export function useCrawlStatus(onUpdate?: () => void) {
  const [crawlState, setCrawlState] = useState<CrawlState>(EMPTY_STATE);

  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const refresh = useCallback(async () => {
    const res = await chrome.runtime.sendMessage({ type: "crawl:status" });
    if (res?.success) {
      setCrawlState(res.data as CrawlState);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // While a crawl runs, poll its progress and refresh the list so articles
  // appear incrementally instead of all at once at the end.
  useEffect(() => {
    if (crawlState.lastCrawlStatus !== "crawling") return;
    let cancelled = false;

    const tick = async () => {
      const res = await chrome.runtime.sendMessage({ type: "crawl:status" });
      if (cancelled || !res?.success) return;
      setCrawlState(res.data as CrawlState);
      onUpdateRef.current?.();
    };

    const timer = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [crawlState.lastCrawlStatus]);

  const startCrawl = useCallback(async () => {
    setCrawlState((prev) => ({ ...prev, lastCrawlStatus: "crawling", lastCrawlError: null }));
    const res = await chrome.runtime.sendMessage({ type: "crawl:start" });
    if (res?.success) {
      setCrawlState(res.data as CrawlState);
      onUpdateRef.current?.();
    } else if (res?.error === "CRAWL_IN_PROGRESS") {
      // A crawl is already running in the background; polling will track it.
    } else {
      setCrawlState((prev) => ({
        ...prev,
        lastCrawlStatus: res.error === SSO_ERROR ? "sso_expired" : "error",
        lastCrawlError: res.error ?? null,
      }));
    }
  }, []);

  const checkSSO = useCallback(async (): Promise<boolean> => {
    const res = await chrome.runtime.sendMessage({ type: "check:sso" });
    return res?.success ? (res.data as boolean) : false;
  }, []);

  return { crawlState, refresh, startCrawl, checkSSO };
}
