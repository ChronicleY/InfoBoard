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
    if (ma !== mb) {
      if (ma === "relevant") return -1;
      if (mb === "relevant") return 1;
    }
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime();
  });

  // Group consecutive irrelevant articles for collapsing
  const grouped = sorted.reduce<{ article: Article; match: PersonalMatch }[][]>((acc, article) => {
    const match = personalMatches[article.id] || "neutral";
    if (match === "irrelevant" && acc.length > 0 && acc[acc.length - 1][0].match === "irrelevant") {
      acc[acc.length - 1].push({ article, match });
    } else {
      acc.push([{ article, match }]);
    }
    return acc;
  }, []);

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
      {grouped.map((group, gi) => {
        const first = group[0];
        if (group.length > 1 && first.match === "irrelevant") {
          return (
            <details key={`irrelevant-${gi}`}>
              <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-500 py-1 select-none">
                折叠 {group.length} 条与其他学院相关的公文
              </summary>
              <div className="space-y-2 mt-1">
                {group.map(({ article }) => (
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
          );
        }

        return group.map(({ article, match }) => (
          <NoticeCard
            key={article.id}
            article={article}
            expanded={expandedIds.has(article.id)}
            personalMatch={match}
            onToggleExpand={onToggleExpand}
            onReclassify={onReclassify}
            onRefresh={onRefresh}
          />
        ));
      })}
    </div>
  );
}
