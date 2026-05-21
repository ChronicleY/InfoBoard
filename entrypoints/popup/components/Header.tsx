interface HeaderProps {
  lastCrawlTime: number | null;
  status: string;
  onRefresh: () => void;
}

export default function Header({ lastCrawlTime, status, onRefresh }: HeaderProps) {
  const isCrawling = status === "crawling";
  const lastTime = lastCrawlTime
    ? new Date(lastCrawlTime).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white sticky top-0 z-10">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded bg-szu-red flex items-center justify-center text-white font-bold text-xs">
          SZU
        </div>
        <div>
          <h1 className="text-sm font-semibold text-gray-900">公文通助手</h1>
          {lastTime && (
            <span className="text-[10px] text-gray-400">上次更新 {lastTime}</span>
          )}
        </div>
      </div>
      <button
        onClick={onRefresh}
        disabled={isCrawling}
        className="px-3 py-1.5 text-xs font-medium rounded-md bg-szu-red text-white hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isCrawling ? "获取中..." : "获取最新"}
      </button>
    </div>
  );
}
