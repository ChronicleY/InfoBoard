import { useState, useEffect } from "react";
import type { Settings } from "../../../modules/types";
import { SZU_COLLEGES } from "../../../modules/types";

interface SettingsPageProps {
  onBack: () => void;
}

export default function SettingsPage({ onBack }: SettingsPageProps) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "settings:get" }).then((res) => {
      if (res?.success) setSettings(res.data as Settings);
    });
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    await chrome.runtime.sendMessage({
      type: "settings:save",
      settings,
    });
    onBack();
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        加载中...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white sticky top-0 z-10">
        <button
          onClick={onBack}
          className="text-gray-500 hover:text-gray-700 text-sm"
        >
          ← 返回
        </button>
        <h2 className="text-sm font-semibold text-gray-900">设置</h2>
        <div className="flex-1" />
        <button
          onClick={handleSave}
          className="px-3 py-1 text-xs font-medium rounded-md bg-szu-red text-white hover:bg-red-900 transition-colors"
        >
          保存
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Section 1: 我的学院 */}
        <section>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">我的学院</h3>
          <p className="text-[10px] text-gray-400 mb-2">选择后，与你学院相关的公文将置顶高亮</p>
          <select
            value={settings.userCollege}
            onChange={(e) => setSettings({ ...settings, userCollege: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white text-gray-700 focus:outline-none focus:border-szu-red"
          >
            <option value="">不选择</option>
            {SZU_COLLEGES.map((college) => (
              <option key={college} value={college}>{college}</option>
            ))}
          </select>
        </section>

        {/* Section 2: 我的课表 */}
        <section>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">我的课表</h3>
          <p className="text-[10px] text-gray-400 mb-2">输入你的课程名称，每行一个。与课程相关的公文将置顶高亮</p>
          <textarea
            value={settings.userCourses.join("\n")}
            onChange={(e) =>
              setSettings({
                ...settings,
                userCourses: e.target.value
                  .split(/[\n,，]+/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder={"高等数学A（2）\n线性代数\n大学英语（2）"}
            rows={4}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md resize-none focus:outline-none focus:border-szu-red"
          />
        </section>

        {/* Section 3: 增强识别 */}
        <section>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">增强识别</h3>
          <p className="text-[10px] text-gray-400 mb-2">配置大模型API后，"待分类"的公文将自动调用模型识别分类</p>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] text-gray-500">API URL</label>
              <input
                type="text"
                value={settings.llmUrl}
                onChange={(e) => setSettings({ ...settings, llmUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1/chat/completions"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-szu-red"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500">API Key</label>
              <input
                type="password"
                value={settings.llmApiKey}
                onChange={(e) => setSettings({ ...settings, llmApiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-szu-red"
              />
            </div>
          </div>
        </section>

        {/* Section 4: 存储时间 */}
        <section>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">公文存储时间</h3>
          <p className="text-[10px] text-gray-400 mb-2">超过天数的非收藏公文将被自动清理</p>
          <select
            value={settings.storageDays}
            onChange={(e) => setSettings({ ...settings, storageDays: Number(e.target.value) })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white text-gray-700 focus:outline-none focus:border-szu-red"
          >
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <option key={d} value={d}>{d} 天</option>
            ))}
          </select>
        </section>
      </div>
    </div>
  );
}
