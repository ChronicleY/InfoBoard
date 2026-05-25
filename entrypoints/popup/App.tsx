import { useState, useEffect, useCallback, useMemo } from "react";
import type { Article, Settings } from "../../modules/types";
import { SZU_COLLEGES, COLLEGE_ALIASES } from "../../modules/types";
import Header from "./components/Header";
import SearchBar from "./components/SearchBar";
import CategoryTabs from "./components/CategoryTabs";
import NoticeList from "./components/NoticeList";
import LoginPrompt from "./components/LoginPrompt";
import ReclassifyModal from "./components/ReclassifyModal";
import { useNotices } from "./hooks/useNotices";
import { useCategories } from "./hooks/useCategories";
import { useCrawlStatus } from "./hooks/useCrawlStatus";

type PersonalMatch = "relevant" | "irrelevant" | "neutral";

export default function App() {
  const { articles, loading, refresh } = useNotices();
  const { categories } = useCategories();
  const { crawlState, startCrawl, checkSSO } = useCrawlStatus(refresh);

  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [ssoValid, setSsoValid] = useState<boolean | null>(null);
  const [reclassifyArticle, setReclassifyArticle] = useState<Article | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    checkSSO().then((valid) => {
      setSsoValid(valid);
      if (valid) startCrawl();
    });
  }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "settings:get" }).then((res) => {
      if (res?.success) setSettings(res.data as Settings);
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

  // Compute personal match for each article based on user college/courses
  const personalMatches = useMemo(() => {
    const map: Record<string, PersonalMatch> = {};
    if (!settings) return map;

    const userCollege = settings.userCollege;
    const userCourses = settings.userCourses.filter(Boolean);

    if (!userCollege && userCourses.length === 0) return map;

    // Build keyword lists
    const collegeKeywords = new Map<string, string[]>();
    for (const c of SZU_COLLEGES) {
      const aliases = COLLEGE_ALIASES[c] || [];
      collegeKeywords.set(c, [c, ...aliases]);
    }

    for (const article of articles) {
      const text = `${article.title} ${article.summary} ${article.publisher}`;

      // Check course match first
      let courseMatch = false;
      if (userCourses.length > 0) {
        courseMatch = userCourses.some((course) => text.includes(course));
      }

      // Check college match
      let collegeMatch: "user" | "other" | "none" = "none";

      for (const [college, keywords] of collegeKeywords) {
        const mentioned = keywords.some((kw) => text.includes(kw));
        if (!mentioned) continue;

        if (college === userCollege) {
          collegeMatch = "user";
        } else if (collegeMatch !== "user") {
          collegeMatch = "other";
        }
      }

      if (collegeMatch === "user" || courseMatch) {
        map[article.id] = "relevant";
      } else if (collegeMatch === "other") {
        map[article.id] = "irrelevant";
      } else {
        map[article.id] = "neutral";
      }
    }

    return map;
  }, [articles, settings]);

  const filteredArticles = useMemo(() => {
    return articles.filter((a) => {
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
  }, [articles, activeCategory, searchQuery]);

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
        onSettings={() => chrome.runtime.openOptionsPage()}
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
          personalMatches={personalMatches}
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
