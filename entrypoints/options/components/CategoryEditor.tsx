import { useEffect, useState } from "react";
import type { CategoryDef } from "../../../modules/types";

interface CategoryEditorProps {
  categories: CategoryDef[];
  onSave: (categories: CategoryDef[]) => void;
}

export default function CategoryEditor({ categories, onSave }: CategoryEditorProps) {
  const [items, setItems] = useState(structuredClone(categories));
  const [newName, setNewName] = useState("");
  const [newKeywords, setNewKeywords] = useState("");

  useEffect(() => {
    setItems(structuredClone(categories));
  }, [categories]);

  const updateKeywords = (id: string, kwStr: string) => {
    setItems((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, keywords: kwStr.split(/[,，]/).map((k) => k.trim()).filter(Boolean) } : c,
      ),
    );
  };

  const addCategory = () => {
    if (!newName.trim()) return;
    const id = `custom_${Date.now()}`;
    setItems((prev) => [
      ...prev,
      {
        id,
        name: newName.trim(),
        keywords: newKeywords.split(/[,，]/).map((k) => k.trim()).filter(Boolean),
        isBuiltin: false,
        sortOrder: Math.max(...prev.map((c) => c.sortOrder), 0) + 1,
      },
    ]);
    setNewName("");
    setNewKeywords("");
  };

  const deleteCategory = (id: string) => {
    setItems((prev) => prev.filter((c) => c.id !== id));
  };

  const handleSave = () => {
    onSave(items);
  };

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">分类管理</h2>
        <button
          onClick={handleSave}
          className="px-3 py-1 text-xs font-medium rounded-md bg-accent-blue text-white hover:bg-blue-700 transition-colors"
        >
          保存
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-4">内置分类可编辑关键词但不可删除。</p>
      <div className="space-y-3">
        {items.filter((cat) => cat.id !== "uncategorized").map((cat) => (
          <div key={cat.id} className="border border-gray-100 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-800">
                {cat.name}
                {cat.isBuiltin && <span className="text-[10px] text-gray-400 ml-1">(内置)</span>}
              </span>
              {!cat.isBuiltin && (
                <button
                  onClick={() => deleteCategory(cat.id)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  删除
                </button>
              )}
            </div>
            {cat.id !== "uncategorized" && (
              <div>
                <label className="text-[10px] text-gray-400">关键词（逗号分隔）</label>
                <input
                  type="text"
                  value={cat.keywords.join("，")}
                  onChange={(e) => updateKeywords(cat.id, e.target.value)}
                  className="w-full mt-0.5 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-accent-blue"
                />
              </div>
            )}
          </div>
        ))}

        {/* Add new category */}
        <div className="border border-dashed border-gray-300 rounded-lg p-3 space-y-2">
          <p className="text-xs text-gray-500">添加自定义分类</p>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="分类名称"
            className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-accent-blue"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={newKeywords}
              onChange={(e) => setNewKeywords(e.target.value)}
              placeholder="关键词（逗号分隔）"
              className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-accent-blue"
            />
            <button
              onClick={addCategory}
              disabled={!newName.trim()}
              className="px-3 py-1 text-xs font-medium rounded bg-szu-red text-white hover:bg-red-900 disabled:opacity-50 transition-colors"
            >
              添加
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
