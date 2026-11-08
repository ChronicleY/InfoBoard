import { useState, useEffect, useCallback, useMemo } from "react";
import type { Article, ClassifierStatus, Settings } from "../../modules/types";
import { SZU_COLLEGES, COLLEGE_ALIASES } from "../../modules/types";
import Header from "./components/Header";
import SearchBar from "./components/SearchBar";
import CategoryTabs from "./components/CategoryTabs";
import NoticeList from "./components/NoticeList";
import LoginPrompt from "./components/LoginPrompt";
import ReclassifyModal from "./components/ReclassifyModal";
import CategoryManager from "./components/CategoryManager";
import { useNotices } from "./hooks/useNotices";
import { useCategories } from "./hooks/useCategories";
import { useCrawlStatus } from "./hooks/useCrawlStatus";

type PersonalMatch = "relevant" | "irrelevant" | "neutral";

export default function App() {
  const { articles, loading, refresh } = useNotices();
  const { categories, revision: categoryRevision, refresh: refreshCategories } = useCategories();
  const { crawlState, startCrawl, checkSSO } = useCrawlStatus(refresh);

  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [ssoValid, setSsoValid] = useState<boolean | null>(null);
  const [reclassifyArticle, setReclassifyArticle] = useState<Article | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<Settings | null>(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [classifierStatus, setClassifierStatus] = useState<ClassifierStatus | null>(null);
  const [classifierBusy, setClassifierBusy] = useState(false);
  const [classifierError, setClassifierError] = useState("");

  const refreshClassifierStatus = useCallback(async () => {
    const response = await chrome.runtime.sendMessage({ type: "classifier:status" });
    if (response?.success) setClassifierStatus(response.data as ClassifierStatus);
  }, []);

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

  useEffect(() => {
    refreshClassifierStatus();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && Object.keys(changes).some((key) => key.startsWith("meta:classifier"))) {
        refreshClassifierStatus();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refreshClassifierStatus]);

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
      if (activeCategory !== "all" && (a.categoryId ?? categories.find((category) => category.name === a.category)?.id) !== activeCategory) return false;
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
  }, [articles, activeCategory, searchQuery, categories]);

  const categoryCounts = categories.reduce<Record<string, number>>((acc, cat) => {
    acc[cat.id] = articles.filter((a) => a.categoryId === cat.id || (!a.categoryId && a.category === cat.name)).length;
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

  const runClassifierAction = async (type: "classifier:train" | "classifier:rollback") => {
    setClassifierBusy(true);
    setClassifierError("");
    try {
      const response = await chrome.runtime.sendMessage({ type });
      if (!response?.success) throw new Error(response?.error ?? "模型操作失败");
      const data = response.data as { status?: ClassifierStatus };
      if (data.status) setClassifierStatus(data.status);
      await refresh();
    } catch (cause) {
      setClassifierError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClassifierBusy(false);
    }
  };

  const openStandaloneView = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html"), active: true });
  };

  const saveCategoryOrder = useCallback(async (order: typeof categories) => {
    const response = await chrome.runtime.sendMessage({ type: "categories:save", categories: order, expectedRevision: categoryRevision });
    if (!response?.success) {
      setClassifierError(response?.error ?? "分类顺序保存失败");
      await refreshCategories();
      return;
    }
    await refreshCategories();
  }, [categories, categoryRevision, refreshCategories]);

  if (ssoValid === false) {
    return <LoginPrompt onRetry={() => checkSSO().then(setSsoValid)} />;
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        crawlState={crawlState}
        onRefresh={handleRefresh}
        onSettings={() => chrome.runtime.openOptionsPage()}
        onCategories={() => setCategoryManagerOpen(true)}
        onOpenTab={openStandaloneView}
      />
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-gray-600">
          {classifierStatus ? `待训练 ${classifierStatus.pendingLabelCount} 条 · 模型 v${classifierStatus.modelVersion ?? 0}` : "正在读取模型状态"}
        </span>
        <button
          type="button"
          onClick={() => runClassifierAction("classifier:train")}
          disabled={classifierBusy || !classifierStatus?.pendingLabelCount}
          className="shrink-0 bg-szu-red px-2.5 py-1.5 text-[11px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {classifierBusy ? "处理中…" : "重训模型"}
        </button>
        <button
          type="button"
          onClick={() => runClassifierAction("classifier:rollback")}
          disabled={classifierBusy || !classifierStatus?.previousModelVersion}
          title={classifierStatus?.previousModelVersion ? `恢复模型 v${classifierStatus.previousModelVersion}` : "没有可回退版本"}
          className="shrink-0 border border-gray-300 px-2 py-1.5 text-[11px] text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          回退
        </button>
      </div>
      {classifierError && <div role="alert" className="border-b border-red-100 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">{classifierError}</div>}
      <SearchBar value={searchQuery} onChange={setSearchQuery} />
      <CategoryTabs
        categories={categories}
        counts={categoryCounts}
        totalCount={totalCount}
        favoriteCount={favoriteCount}
        active={activeCategory}
        onSelect={setActiveCategory}
        onReorder={saveCategoryOrder}
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
          onReclassified={async () => { await refresh(); await refreshClassifierStatus(); }}
        />
      )}
      {categoryManagerOpen && (
        <CategoryManager
          categories={categories}
          revision={categoryRevision}
          onClose={() => setCategoryManagerOpen(false)}
          onSaved={refreshCategories}
        />
      )}
    </div>
  );
}
