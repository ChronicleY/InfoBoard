import { useState, useEffect } from "react";
import type { ClassifierStatus, Settings } from "../../modules/types";
import { SZU_COLLEGES } from "../../modules/types";

function csvCell(value: unknown): string {
  const raw = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  const text = /^[\u0000-\u0020]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replace(/"/g, '""')}"`;
}

function classifierCsv(articles: Array<Record<string, unknown>>): string {
  const columns = [
    ["article_id", "articleId"],
    ["original_url", "url"],
    ["title", "title"],
    ["summary", "summary"],
    ["body_text", "bodyText"],
    ["section", "section"],
    ["publisher", "publisher"],
    ["location", "location"],
    ["event_time", "eventTime"],
    ["event_date", "eventDate"],
    ["updated_at", "updatedAt"],
    ["topic", "topic"],
    ["title_attributes", "titleAttributes"],
    ["publish_date", "publishDate"],
    ["predicted_category", "predictedCategory"],
    ["matched_keywords", "matchedKeywords"],
    ["confirmed_category", ""],
  ] as const;
  const header = columns.map(([label]) => csvCell(label)).join(",");
  const rows = articles.map((item) => {
    const article = (item.article ?? {}) as Record<string, unknown>;
    return columns.map(([, key]) => csvCell(key ? item[key] ?? article[key] : "")).join(",");
  });
  return [header, ...rows].join("\r\n");
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [coursesText, setCoursesText] = useState("");
  const [classifier, setClassifier] = useState<ClassifierStatus | null>(null);
  const [classifierBusy, setClassifierBusy] = useState("");
  const [classifierMessage, setClassifierMessage] = useState("");

  useEffect(() => {
    loadData();
    refreshClassifierStatus();
  }, []);

  const refreshClassifierStatus = async () => {
    const res = await chrome.runtime.sendMessage({ type: "classifier:status" });
    if (res?.success) setClassifier(res.data as ClassifierStatus);
    else setClassifierMessage(res?.error ?? "分类器状态加载失败");
  };

  const loadData = async () => {
    const res = await chrome.runtime.sendMessage({ type: "settings:get" });
    if (res?.success) {
      const s = res.data as Settings;
      setSettings(s);
      setCoursesText(s.userCourses.join("\n"));
    }
  };

  const handleSaveSettings = async (partial: Partial<Settings>) => {
    await chrome.runtime.sendMessage({ type: "settings:save", settings: partial });
    setSettings((prev) => prev ? { ...prev, ...partial } : prev);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleExport = async () => {
    setClassifierBusy("export");
    setClassifierMessage("");
    try {
      const res = await chrome.runtime.sendMessage({ type: "classifier:export" });
      if (!res?.success) throw new Error(res?.error ?? "導出失敗");
      const { articles } = res.data as { articles: Array<Record<string, unknown>> };
      const blob = new Blob(["\uFEFF", classifierCsv(articles)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `szu-classifier-training-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setClassifierMessage(`已导出 ${articles.length} 条记录。`);
    } catch (error) {
      setClassifierMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setClassifierBusy("");
    }
  };

  const handleBackupExport = async () => {
    setClassifierBusy("backup");
    setClassifierMessage("");
    try {
      const res = await chrome.runtime.sendMessage({ type: "classifier:export" });
      if (!res?.success) throw new Error(res?.error ?? "完整备份导出失败");
      const data = res.data as {
        articles: Array<Record<string, unknown>>;
        taxonomy: unknown;
        state: { current: unknown; previous: unknown; feedback: unknown[]; feedbackRevision: number };
      };
      const rows = [
        JSON.stringify({
          type: "backup-meta",
          schemaVersion: 2,
          exportedAt: Date.now(),
          feedbackRevision: data.state.feedbackRevision,
          currentModelVersion: (data.state.current as { version?: number } | null)?.version ?? null,
          previousModelVersion: (data.state.previous as { version?: number } | null)?.version ?? null,
        }),
        JSON.stringify({ type: "taxonomy-snapshot", taxonomy: data.taxonomy }),
        ...data.articles.map((article) => JSON.stringify({ type: "article-snapshot", ...article })),
        ...data.state.feedback.map((record) => JSON.stringify({ type: "manual-label", record })),
        ...(data.state.current ? [JSON.stringify({ type: "model-snapshot", role: "current", model: data.state.current })] : []),
        ...(data.state.previous ? [JSON.stringify({ type: "model-snapshot", role: "previous", model: data.state.previous })] : []),
      ];
      const blob = new Blob([rows.join("\n")], { type: "application/x-ndjson;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `szu-classifier-backup-${new Date().toISOString().slice(0, 10)}.jsonl`;
      link.click();
      URL.revokeObjectURL(url);
      setClassifierMessage(`已导出完整备份，包含 ${data.articles.length} 条文章快照与 ${data.state.feedback.length} 条人工标注历史。`);
    } catch (error) {
      setClassifierMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setClassifierBusy("");
    }
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    setClassifierBusy("import");
    setClassifierMessage("");
    try {
      const csv = await file.text();
      const res = await chrome.runtime.sendMessage({ type: "classifier:import-labels", csv });
      if (!res?.success) throw new Error(res?.error ?? "导入失败");
      const result = res.data as {
        imported: number;
        skippedBlank: number;
        duplicateIds: string[];
        invalidRows: number;
        invalidCategories: string[];
        unknownIds: string[];
        status: ClassifierStatus;
      };
      setClassifier(result.status);
      const details = [
        result.duplicateIds.length ? `重复 ID: ${result.duplicateIds.slice(0, 8).join(", ")}${result.duplicateIds.length > 8 ? " …" : ""}` : "",
        result.unknownIds.length ? `未知 ID: ${result.unknownIds.slice(0, 8).join(", ")}${result.unknownIds.length > 8 ? " …" : ""}` : "",
        result.invalidCategories.length ? `无效分类: ${result.invalidCategories.slice(0, 8).join(", ")}${result.invalidCategories.length > 8 ? " …" : ""}` : "",
      ].filter(Boolean);
      setClassifierMessage(
        `已导入 ${result.imported} 条；空标签跳过 ${result.skippedBlank} 条；无效行 ${result.invalidRows} 行。${details.length ? ` ${details.join("；")}` : ""}`,
      );
    } catch (error) {
      setClassifierMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setClassifierBusy("");
    }
  };

  const handleClassifierAction = async (type: "classifier:train" | "classifier:rollback") => {
    setClassifierBusy(type);
    setClassifierMessage("");
    try {
      const res = await chrome.runtime.sendMessage({ type });
      if (!res?.success) throw new Error(res?.error ?? "分类器操作失败");
      const result = res.data as { status: ClassifierStatus; reclassified: number };
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
            <p className="text-xs text-gray-400">分类模型与个性化偏好</p>
          </div>
        </div>
        {saved && (
          <span className="text-xs text-green-600 font-medium">✓ 已保存</span>
        )}
      </div>

      <div className="space-y-6">
        <section className="border border-gray-200 rounded-lg p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">分类模型</h2>
            <p className="text-xs text-gray-500 mt-1">
              当前版本：{classifier?.modelVersion == null ? "尚未初始化" : `v${classifier.modelVersion}`}；
              人工标签：{classifier?.labeledArticleCount ?? 0} 条；待训练：{classifier?.pendingLabelCount ?? 0} 条
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleExport}
              disabled={Boolean(classifierBusy)}
              className="px-3 py-2 text-xs rounded-md border border-gray-200 text-gray-700 disabled:opacity-50"
            >
              导出训练数据 CSV
            </button>
            <button
              onClick={handleBackupExport}
              disabled={Boolean(classifierBusy)}
              className="px-3 py-2 text-xs rounded-md border border-gray-200 text-gray-700 disabled:opacity-50"
            >
              导出完整备份 JSONL
            </button>
            <label className={`px-3 py-2 text-xs rounded-md border border-gray-200 text-gray-700 cursor-pointer ${classifierBusy ? "opacity-50 pointer-events-none" : ""}`}>
              导入人工标签 CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                disabled={Boolean(classifierBusy)}
                onChange={(event) => {
                  void handleImport(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button
              onClick={() => void handleClassifierAction("classifier:train")}
              disabled={Boolean(classifierBusy) || !classifier?.labeledArticleCount}
              className="px-3 py-2 text-xs rounded-md bg-szu-red text-white disabled:opacity-50"
            >
              {classifierBusy === "classifier:train" ? "正在训练…" : "按人工标签重新训练"}
            </button>
            <button
              onClick={() => void handleClassifierAction("classifier:rollback")}
              disabled={Boolean(classifierBusy) || classifier?.previousModelVersion == null}
              className="px-3 py-2 text-xs rounded-md border border-gray-200 text-gray-700 disabled:opacity-50"
            >
              {classifierBusy === "classifier:rollback" ? "正在回退…" : `回退到上一版本${classifier?.previousModelVersion == null ? "" : ` v${classifier.previousModelVersion}`}`}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            导出表格中的 confirmed_category 会留空。只填写这一列后再导入；predicted_category 仅供参考，不会作为人工标签。标题与原文链接可用于核对。
          </p>
          {classifierMessage && <p className="text-xs text-gray-600 break-words">{classifierMessage}</p>}
        </section>

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
      </div>
    </div>
  );
}
