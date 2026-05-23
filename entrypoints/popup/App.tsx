import { useState, useEffect, useCallback } from "react";
import type { Article } from "../../modules/types";
import Header from "./components/Header";
import SearchBar from "./components/SearchBar";
import CategoryTabs from "./components/CategoryTabs";
import NoticeList from "./components/NoticeList";
import LoginPrompt from "./components/LoginPrompt";
import ReclassifyModal from "./components/ReclassifyModal";
import { useNotices } from "./hooks/useNotices";
import { useCategories } from "./hooks/useCategories";
import { useCrawlStatus } from "./hooks/useCrawlStatus";

export default function App() {
  const { articles, loading, refresh } = useNotices();
  const { categories } = useCategories();
  const { crawlState, startCrawl, checkSSO } = useCrawlStatus(refresh);

  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [ssoValid, setSsoValid] = useState<boolean | null>(null);
  const [reclassifyArticle, setReclassifyArticle] = useState<Article | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    checkSSO().then((valid) => {
      setSsoValid(valid);
      if (valid) startCrawl();
    });
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filteredArticles = articles.filter((a) => {
    if (activeCategory === "favorites") return a.favorite;
    if (activeCategory !== "all" && a.category !== activeCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        a.title.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.publisher.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const categoryCounts = categories.reduce<Record<string, number>>((acc, cat) => {
    acc[cat.name] = articles.filter((a) => a.category === cat.name).length;
    return acc;
  }, {});

  const totalCount = articles.length;
  const favoriteCount = articles.filter((a) => a.favorite).length;

  const handleRefresh = async () => {
    const valid = await checkSSO();
    setSsoValid(valid);
    if (valid) {
      await startCrawl();
    }
  };

  if (ssoValid === false) {
    return <LoginPrompt onRetry={() => checkSSO().then(setSsoValid)} />;
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        crawlState={crawlState}
        onRefresh={handleRefresh}
      />
      <SearchBar value={searchQuery} onChange={setSearchQuery} />
      <CategoryTabs
        categories={categories}
        counts={categoryCounts}
        totalCount={totalCount}
        favoriteCount={favoriteCount}
        active={activeCategory}
        onSelect={setActiveCategory}
      />
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          加载中...
        </div>
      ) : (
        <NoticeList
          articles={filteredArticles}
          expandedIds={expandedIds}
          onToggleExpand={toggleExpand}
          onReclassify={setReclassifyArticle}
          onRefresh={refresh}
        />
      )}
      {reclassifyArticle && (
        <ReclassifyModal
          article={reclassifyArticle}
          categories={categories}
          onClose={() => setReclassifyArticle(null)}
          onReclassified={refresh}
        />
      )}
    </div>
  );
}
