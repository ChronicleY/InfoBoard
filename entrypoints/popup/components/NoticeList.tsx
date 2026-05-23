import type { Article } from "../../../modules/types";
import NoticeCard from "./NoticeCard";

interface NoticeListProps {
  articles: Article[];
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onReclassify: (article: Article) => void;
  onRefresh: () => void;
}

export default function NoticeList({ articles, expandedIds, onToggleExpand, onReclassify, onRefresh }: NoticeListProps) {
  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <div className="text-4xl mb-2">📭</div>
        <p className="text-sm">暂无公文</p>
        <p className="text-xs mt-1">点击"获取最新"开始抓取</p>
      </div>
    );
  }

  // Favorited first, then by publishDate descending
  const sorted = [...articles].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime();
  });

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
      {sorted.map((article) => (
        <NoticeCard
          key={article.id}
          article={article}
          expanded={expandedIds.has(article.id)}
          onToggleExpand={onToggleExpand}
          onReclassify={onReclassify}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}
