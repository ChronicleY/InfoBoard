import { useState, useEffect } from "react";
import type { CategoryDef, Settings } from "../../modules/types";
import { SZU_COLLEGES } from "../../modules/types";
import ApiKeySection from "./components/ApiKeySection";
import CategoryEditor from "./components/CategoryEditor";
import SubscriptionSelector from "./components/SubscriptionSelector";

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [saved, setSaved] = useState(false);
  const [coursesText, setCoursesText] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [settingsRes, categoriesRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: "settings:get" }),
      chrome.runtime.sendMessage({ type: "categories:list" }),
    ]);
    if (settingsRes?.success) {
      const s = settingsRes.data as Settings;
      setSettings(s);
      setCoursesText(s.userCourses.join("\n"));
    }
    if (categoriesRes?.success) setCategories(categoriesRes.data as CategoryDef[]);
  };

  const handleSaveSettings = async (partial: Partial<Settings>) => {
    await chrome.runtime.sendMessage({ type: "settings:save", settings: partial });
    setSettings((prev) => prev ? { ...prev, ...partial } : prev);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveCategories = async (updated: CategoryDef[]) => {
    await chrome.runtime.sendMessage({ type: "categories:save", categories: updated });
    setCategories(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-400">
        加载中...
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-szu-red flex items-center justify-center text-white font-bold text-sm">
            SZU
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">公文通助手设置</h1>
            <p className="text-xs text-gray-400">配置 API、分类规则和订阅板块</p>
          </div>
        </div>
        {saved && (
          <span className="text-xs text-green-600 font-medium">✓ 已保存</span>
        )}
      </div>

      <div className="space-y-6">
        <ApiKeySection
          apiKey={settings.deepseekApiKey}
          model={settings.deepseekModel}
          apiUrl={settings.llmUrl}
          onSave={handleSaveSettings}
        />
        <SubscriptionSelector
          selected={settings.subscriptions}
          onSave={(subs) => handleSaveSettings({ subscriptions: subs })}
        />

        {/* ===== 个性化设置 ===== */}
        <section className="border border-gray-200 rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">个性化设置</h2>

          {/* 我的学院 */}
          <div>
            <label className="text-sm font-medium text-gray-700">我的学院</label>
            <p className="text-xs text-gray-400 mt-0.5 mb-1.5">选择后，与你学院相关的公文将置顶高亮</p>
            <select
              value={settings.userCollege}
              onChange={(e) => handleSaveSettings({ userCollege: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white text-gray-700 focus:outline-none focus:border-szu-red"
            >
              <option value="">不选择</option>
              {SZU_COLLEGES.map((college) => (
                <option key={college} value={college}>{college}</option>
              ))}
            </select>
          </div>

          {/* 我的课表 */}
          <div>
            <label className="text-sm font-medium text-gray-700">我的课表</label>
            <p className="text-xs text-gray-400 mt-0.5 mb-1.5">输入你的课程名称，每行一个。与课程相关的公文将置顶高亮</p>
            <textarea
              value={coursesText}
              onChange={(e) => setCoursesText(e.target.value)}
              onBlur={() =>
                handleSaveSettings({
                  userCourses: coursesText
                    .split(/[\n]+/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="高等数学A（2）&#10;线性代数&#10;大学英语（2）"
              rows={4}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md resize-none focus:outline-none focus:border-szu-red"
            />
          </div>

          {/* 存储时间 */}
          <div>
            <label className="text-sm font-medium text-gray-700">公文存储时间</label>
            <p className="text-xs text-gray-400 mt-0.5 mb-1.5">超过天数的非收藏公文将被自动清理</p>
            <select
              value={settings.storageDays}
              onChange={(e) => handleSaveSettings({ storageDays: Number(e.target.value) })}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white text-gray-700 focus:outline-none focus:border-szu-red"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>{d} 天</option>
              ))}
            </select>
          </div>
        </section>

        <CategoryEditor
          categories={categories}
          onSave={handleSaveCategories}
        />
      </div>
    </div>
  );
}
