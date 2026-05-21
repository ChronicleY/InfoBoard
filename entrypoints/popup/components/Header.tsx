import type { CrawlState } from "../../../modules/types";

interface HeaderProps {
  crawlState: CrawlState;
  onRefresh: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  idle: "",
  crawling: "正在获取最新公文...",
  success: "已更新",
  partial: "部分成功",
  error: "获取失败",
  sso_expired: "登录已过期",
};

export default function Header({ crawlState, onRefresh }: HeaderProps) {
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
