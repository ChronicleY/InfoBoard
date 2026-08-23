import { useState } from "react";

interface ApiKeySectionProps {
  apiKey: string;
  onSave: (partial: { deepseekApiKey: string }) => void;
}

export default function ApiKeySection({ apiKey, onSave }: ApiKeySectionProps) {
  const [key, setKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleSave = () => {
    onSave({ deepseekApiKey: key });
  };

  const handleTest = async () => {
    if (!key) {
      setTestResult("请先输入 API Key");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 5,
        }),
      });
      if (res.ok) {
        setTestResult("✓ 连接成功");
      } else {
        const data = (await res.json()) as { error?: { message?: string } };
        setTestResult(`✗ 错误: ${data.error?.message || res.status}`);
      }
    } catch {
      setTestResult("✗ 网络错误");
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">DeepSeek API 配置</h2>
      <p className="text-xs text-gray-500 mb-4">
        配置 DeepSeek API Key 后，关键词无法匹配的公文将自动调用 AI 识别分类。Key 仅存储在本地浏览器中。
      </p>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-600">API Key</label>
          <div className="flex gap-2 mt-1">
            <input
              type={showKey ? "text" : "password"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-..."
              className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent-blue"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50"
            >
              {showKey ? "隐藏" : "显示"}
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="px-4 py-1.5 text-xs font-medium rounded-md bg-accent-blue text-white hover:bg-blue-700 transition-colors"
          >
            保存
          </button>
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-4 py-1.5 text-xs font-medium rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {testing ? "测试中..." : "测试连接"}
          </button>
          {testResult && (
            <span className={`text-xs self-center ${testResult.startsWith("✓") ? "text-green-600" : "text-red-500"}`}>
              {testResult}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
