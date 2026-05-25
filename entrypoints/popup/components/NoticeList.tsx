import type { Article } from "../../../modules/types";
import NoticeCard from "./NoticeCard";

type PersonalMatch = "relevant" | "irrelevant" | "neutral";

interface NoticeListProps {
  articles: Article[];
  expandedIds: Set<string>;
  personalMatches: Record<string, PersonalMatch>;
  onToggleExpand: (id: string) => void;
  onReclassify: (article: Article) => void;
  onRefresh: () => void;
}

export default function NoticeList({ articles, expandedIds, personalMatches, onToggleExpand, onReclassify, onRefresh }: NoticeListProps) {
  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <div className="text-4xl mb-2">📭</div>
        <p className="text-sm">暂无公文</p>
        <p className="text-xs mt-1">点击"获取最新"开始抓取</p>
      </div>
    );
  }

  const sorted = [...articles].sort((a, b) => {
    const ma = personalMatches[a.id] || "neutral";
    const mb = personalMatches[b.id] || "neutral";
    // relevant > neutral > irrelevant
    const rank: Record<string, number> = { relevant: 0, neutral: 1, irrelevant: 2 };
    const ra = rank[ma];
    const rb = rank[mb];
    if (ra !== rb) return ra - rb;
    // Within same rank: favorite first, then by date
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime();
  });

  const visible = sorted.filter((a) => {
    const m = personalMatches[a.id] || "neutral";
    return m !== "irrelevant";
  });
  const irrelevant = sorted.filter((a) => {
    const m = personalMatches[a.id] || "neutral";
    return m === "irrelevant";
  });

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
      {visible.map((article) => (
        <NoticeCard
          key={article.id}
          article={article}
          expanded={expandedIds.has(article.id)}
          personalMatch={personalMatches[article.id] || "neutral"}
          onToggleExpand={onToggleExpand}
          onReclassify={onReclassify}
          onRefresh={onRefresh}
        />
      ))}

      {irrelevant.length > 0 && (
        <details>
          <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-500 py-1 select-none">
            折叠 {irrelevant.length} 条与其他学院相关的公文
          </summary>
          <div className="space-y-2 mt-1">
            {irrelevant.map((article) => (
              <NoticeCard
                key={article.id}
                article={article}
                expanded={expandedIds.has(article.id)}
                personalMatch="irrelevant"
                onToggleExpand={onToggleExpand}
                onReclassify={onReclassify}
                onRefresh={onRefresh}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
