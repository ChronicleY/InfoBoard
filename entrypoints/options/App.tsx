import { useState, useEffect, useCallback } from "react";
import { RotateCcw, Settings2, Undo2 } from "lucide-react";
import type { ClassifierStatus, Settings } from "../../modules/types";
import { SZU_COLLEGES } from "../../modules/types";
import CategoryManager from "../popup/components/CategoryManager";
import { useCategories } from "../popup/hooks/useCategories";

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [coursesText, setCoursesText] = useState("");
  const [classifier, setClassifier] = useState<ClassifierStatus | null>(null);
  const [classifierBusy, setClassifierBusy] = useState("");
  const [classifierMessage, setClassifierMessage] = useState("");
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const { categories, revision, refresh: refreshCategories } = useCategories();

  const refreshClassifierStatus = useCallback(async () => {
    const response = await chrome.runtime.sendMessage({ type: "classifier:status" });
    if (response?.success) setClassifier(response.data as ClassifierStatus);
    else setClassifierMessage(response?.error ?? "分类器状态加载失败");
  }, []);

  useEffect(() => {
    void (async () => {
      const response = await chrome.runtime.sendMessage({ type: "settings:get" });
      if (response?.success) {
        const next = response.data as Settings;
        setSettings(next);
        setCoursesText(next.userCourses.join("\n"));
      }
    })();
    void refreshClassifierStatus();
  }, [refreshClassifierStatus]);

  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && Object.keys(changes).some((key) => key.startsWith("meta:classifier"))) {
        void refreshClassifierStatus();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refreshClassifierStatus]);

  const handleSaveSettings = async (partial: Partial<Settings>) => {
    const response = await chrome.runtime.sendMessage({ type: "settings:save", settings: partial });
    if (response?.success) {
      setSettings((prev) => prev ? { ...prev, ...partial } : prev);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleClassifierAction = async (type: "classifier:train" | "classifier:rollback") => {
    setClassifierBusy(type);
    setClassifierMessage("");
    try {
      const response = await chrome.runtime.sendMessage({ type });
      if (!response?.success) throw new Error(response?.error ?? "分类器操作失败");
      const result = response.data as { status: ClassifierStatus; reclassified: number };
      setClassifier(result.status);
      setClassifierMessage(`完成，重新分类 ${result.reclassified} 条未锁定文章。`);
    } catch (error) {
      setClassifierMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setClassifierBusy("");
    }
  };

  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-400">
        加载中...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-szu-red text-sm font-bold text-white">SZU</div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">公文通助手设置</h1>
            <p className="text-xs text-gray-400">分类模型与个性化偏好</p>
          </div>
        </div>
        {saved && <span className="text-xs font-medium text-green-600">已保存</span>}
      </div>

      <div className="space-y-6">
        <section className="space-y-4 rounded-lg border border-gray-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">分类模型</h2>
              <p className="mt-1 text-xs text-gray-500">
                当前 v{classifier?.modelVersion ?? 0} · 人工标签 {classifier?.labeledArticleCount ?? 0} 条 · 待训练 {classifier?.pendingLabelCount ?? 0} 条
              </p>
            </div>
            <button
              onClick={() => setCategoryManagerOpen(true)}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-700 hover:border-gray-400"
            >
              <Settings2 className="h-3.5 w-3.5" />
              管理分类
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void handleClassifierAction("classifier:train")}
              disabled={Boolean(classifierBusy) || !classifier?.labeledArticleCount}
              className="flex items-center gap-1.5 rounded-md bg-szu-red px-3 py-2 text-xs text-white disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {classifierBusy === "classifier:train" ? "正在训练…" : "重新训练"}
            </button>
            <button
              onClick={() => void handleClassifierAction("classifier:rollback")}
              disabled={Boolean(classifierBusy) || classifier?.previousModelVersion == null}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-700 disabled:opacity-50"
            >
              <Undo2 className="h-3.5 w-3.5" />
              {classifierBusy === "classifier:rollback" ? "正在回退…" : `回退${classifier?.previousModelVersion == null ? "" : `到 v${classifier.previousModelVersion}`}`}
            </button>
          </div>
          <p className="text-xs text-gray-500">人工纠正会立即生效，只有点击重新训练才更新模型参数；回退保留上一版模型。</p>
          {classifierMessage && <p className="break-words text-xs text-gray-600">{classifierMessage}</p>}
        </section>

        <section className="space-y-4 rounded-lg border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-900">个性化设置</h2>

          <div>
            <label className="text-sm font-medium text-gray-700" htmlFor="user-college">我的学院</label>
            <p className="mb-1.5 mt-0.5 text-xs text-gray-400">选择后，与你学院相关的公文将置顶高亮</p>
            <select
              id="user-college"
              value={settings.userCollege}
              onChange={(event) => void handleSaveSettings({ userCollege: event.target.value })}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-szu-red focus:outline-none"
            >
              <option value="">不选择</option>
              {SZU_COLLEGES.map((college) => (
                <option key={college} value={college}>{college}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700" htmlFor="user-courses">我的课表</label>
            <p className="mb-1.5 mt-0.5 text-xs text-gray-400">输入你的课程名称，每行一个。与课程相关的公文将置顶高亮</p>
            <textarea
              id="user-courses"
              value={coursesText}
              onChange={(event) => setCoursesText(event.target.value)}
              onBlur={() => void handleSaveSettings({
                userCourses: coursesText.split(/\n+/).map((course) => course.trim()).filter(Boolean),
              })}
              placeholder="高等数学A（2）&#10;线性代数&#10;大学英语（2）"
              rows={4}
              className="w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-szu-red focus:outline-none"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700" htmlFor="storage-days">公文存储时间</label>
            <p className="mb-1.5 mt-0.5 text-xs text-gray-400">超过天数的非收藏公文会立即从列表清理</p>
            <select
              id="storage-days"
              value={settings.storageDays}
              onChange={(event) => void handleSaveSettings({ storageDays: Number(event.target.value) })}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-szu-red focus:outline-none"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((days) => (
                <option key={days} value={days}>{days} 天</option>
              ))}
            </select>
          </div>
        </section>
      </div>

      {categoryManagerOpen && (
        <CategoryManager
          categories={categories}
          revision={revision}
          onClose={() => setCategoryManagerOpen(false)}
          onSaved={refreshCategories}
        />
      )}
    </div>
  );
}
