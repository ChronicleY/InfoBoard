import { useState, useEffect, useCallback } from "react";
import type { CategoryDef, Settings, Competition } from "../../modules/types";
import ApiKeySection from "./components/ApiKeySection";
import CategoryEditor from "./components/CategoryEditor";
import SubscriptionSelector from "./components/SubscriptionSelector";
import CompetitionList from "./components/CompetitionList";

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [settingsRes, categoriesRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: "settings:get" }),
      chrome.runtime.sendMessage({ type: "categories:list" }),
    ]);
    if (settingsRes?.success) setSettings(settingsRes.data as Settings);
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
          onSave={handleSaveSettings}
        />
        <SubscriptionSelector
          selected={settings.subscriptions}
          onSave={(subs) => handleSaveSettings({ subscriptions: subs })}
        />
        <CategoryEditor
          categories={categories}
          onSave={handleSaveCategories}
        />
        <CompetitionList />
      </div>
    </div>
  );
}
