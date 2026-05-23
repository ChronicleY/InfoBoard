import type { CrawlState } from "../../../modules/types";

interface HeaderProps {
  crawlState: CrawlState;
  onRefresh: () => void;
  onSettings: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  idle: "",
  crawling: "正在获取最新公文...",
  success: "已更新",
  partial: "部分成功",
  error: "获取失败",
  sso_expired: "登录已过期",
};

export default function Header({ crawlState, onRefresh, onSettings }: HeaderProps) {
  const isCrawling = crawlState.lastCrawlStatus === "crawling";
  const statusLabel = STATUS_LABELS[crawlState.lastCrawlStatus] || "";
  const lastTime = crawlState.lastCrawlTime
    ? new Date(crawlState.lastCrawlTime).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="flex flex-col px-4 py-3 border-b border-gray-100 bg-white sticky top-0 z-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-szu-red flex items-center justify-center text-white font-bold text-xs">
            SZU
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900">公文通助手</h1>
            {lastTime && crawlState.lastCrawlStatus === "success" && (
              <span className="text-[10px] text-gray-400">上次更新 {lastTime}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {crawlState.newArticleCount > 0 && crawlState.lastCrawlStatus === "success" && (
            <span className="text-[10px] text-green-600">+{crawlState.newArticleCount} 篇</span>
          )}
          {crawlState.totalArticleCount > 0 && (
            <span className="text-[10px] text-gray-400">{crawlState.totalArticleCount} 篇</span>
          )}
          <button
            onClick={onSettings}
            className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
            title="设置"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <button
            onClick={onRefresh}
            disabled={isCrawling}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-szu-red text-white hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isCrawling ? "获取中..." : "获取最新"}
          </button>
        </div>
      </div>
      {statusLabel && statusLabel !== "已更新" && (
        <div className={`mt-1.5 text-[10px] px-2 py-1 rounded ${
          crawlState.lastCrawlStatus === "crawling" ? "text-blue-600 bg-blue-50" :
          crawlState.lastCrawlStatus === "error" || crawlState.lastCrawlStatus === "sso_expired" ? "text-red-600 bg-red-50" :
          "text-yellow-600 bg-yellow-50"
        }`}>
          {statusLabel}
          {crawlState.lastCrawlError && crawlState.lastCrawlStatus !== "crawling" && (
            <span> — {crawlState.lastCrawlError}</span>
          )}
        </div>
      )}
    </div>
  );
}
