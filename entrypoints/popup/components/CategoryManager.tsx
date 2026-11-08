import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, X } from "lucide-react";
import type { CategoryDef } from "../../../modules/types";

interface CategoryManagerProps {
  categories: CategoryDef[];
  revision: number;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export default function CategoryManager({ categories, revision, onClose, onSaved }: CategoryManagerProps) {
  const [draft, setDraft] = useState(() => categories.map((category) => ({ ...category, keywords: [...category.keywords] })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [keywordInputs, setKeywordInputs] = useState<Record<string, string>>(() => Object.fromEntries(categories.map((category) => [category.id, category.keywords.join("，")])));
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!draggingId) return;
    const move = (event: PointerEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-category-id]");
      const overId = target?.dataset.categoryId;
      if (!overId || overId === draggingId) return;
      setDraft((items) => {
        const from = items.findIndex((item) => item.id === draggingId);
        const to = items.findIndex((item) => item.id === overId);
        if (from < 0 || to < 0 || from === to) return items;
        const reordered = [...items];
        const [moving] = reordered.splice(from, 1);
        reordered.splice(to, 0, moving);
        return reordered;
      });
    };
    const end = () => setDraggingId(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [draggingId]);

  useEffect(() => () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }, []);

  const update = (id: string, changes: Partial<CategoryDef>) => {
    setDraft((items) => items.map((item) => item.id === id ? { ...item, ...changes } : item));
  };

  const move = (id: string, delta: number) => {
    setDraft((items) => {
      const from = items.findIndex((item) => item.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= items.length) return items;
      const reordered = [...items];
      const [item] = reordered.splice(from, 1);
      reordered.splice(to, 0, item);
      return reordered;
    });
  };

  const add = () => {
    const id = crypto.randomUUID();
    setDraft((items) => [...items, { id, name: "新分类", keywords: [], isBuiltin: false, sortOrder: items.length }]);
    setKeywordInputs((items) => ({ ...items, [id]: "" }));
  };

  const remove = (id: string) => {
    if (id === "other") return;
    setDraft((items) => items.filter((item) => item.id !== id));
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const categories = draft.map((category) => ({
        ...category,
        keywords: (keywordInputs[category.id] ?? "").split(/[，,]/).map((word) => word.trim()).filter(Boolean),
      }));
      const response = await chrome.runtime.sendMessage({ type: "categories:save", categories, expectedRevision: revision });
      if (!response?.success) throw new Error(response?.error ?? "分类保存失败");
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/35 sm:items-center sm:p-5" onClick={onClose}>
      <section className="flex max-h-[92vh] w-full max-w-xl flex-col bg-white sm:rounded-lg" onClick={(event) => event.stopPropagation()} aria-labelledby="category-manager-title">
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h2 id="category-manager-title" className="text-sm font-semibold text-gray-900">管理分类</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">新分类需人工纠正并重训后才参与自动判断</p>
          </div>
          <button type="button" onClick={onClose} title="关闭" aria-label="关闭" className="p-1 text-gray-500 hover:text-gray-900"><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {draft.map((category, index) => (
            <div
              key={category.id}
              data-category-id={category.id}
              className={`rounded border p-2.5 ${draggingId === category.id ? "border-szu-red bg-red-50" : "border-gray-200"}`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  title="按住后拖动排序"
                  aria-label={`${category.name}排序手柄`}
                  onPointerDown={(event) => {
                    if (pressTimer.current) clearTimeout(pressTimer.current);
                    event.currentTarget.setPointerCapture(event.pointerId);
                    pressTimer.current = setTimeout(() => setDraggingId(category.id), 280);
                  }}
                  onPointerUp={(event) => {
                    if (pressTimer.current) clearTimeout(pressTimer.current);
                    pressTimer.current = null;
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                  }}
                  onPointerCancel={(event) => {
                    if (pressTimer.current) clearTimeout(pressTimer.current);
                    pressTimer.current = null;
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                    setDraggingId(null);
                  }}
                  className="touch-none select-none cursor-grab px-1 text-gray-400 active:cursor-grabbing"
                >
                  <GripVertical size={16} />
                </button>
                <input
                  aria-label="分类名称"
                  value={category.name}
                  onChange={(event) => update(category.id, { name: event.target.value })}
                  className="min-w-0 flex-1 border-b border-gray-200 bg-transparent px-1 py-1 text-sm text-gray-900 outline-none focus:border-szu-red"
                />
                <button type="button" onClick={() => move(category.id, -1)} disabled={index === 0} title="上移" aria-label="上移" className="p-1 text-gray-500 disabled:opacity-30"><ArrowUp size={14} /></button>
                <button type="button" onClick={() => move(category.id, 1)} disabled={index === draft.length - 1} title="下移" aria-label="下移" className="p-1 text-gray-500 disabled:opacity-30"><ArrowDown size={14} /></button>
                <button type="button" onClick={() => remove(category.id)} disabled={category.id === "other"} title="删除分类" aria-label="删除分类" className="p-1 text-gray-400 hover:text-red-700 disabled:opacity-20"><Trash2 size={14} /></button>
              </div>
              <input
                aria-label={`${category.name}关键词`}
                value={keywordInputs[category.id] ?? ""}
                onChange={(event) => setKeywordInputs((items) => ({ ...items, [category.id]: event.target.value }))}
                placeholder="关键词，用逗号分隔"
                className="mt-2 w-full border-b border-gray-100 bg-transparent px-1 py-1 text-xs text-gray-600 outline-none focus:border-szu-red"
              />
            </div>
          ))}
          <button type="button" onClick={add} className="flex w-full items-center justify-center gap-1.5 border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-600 hover:border-szu-red hover:text-szu-red"><Plus size={14} />添加分类</button>
        </div>
        {error && <p role="alert" className="px-4 pb-2 text-xs text-red-700">{error}</p>}
        <footer className="flex justify-end gap-2 border-t border-gray-200 p-3">
          <button type="button" onClick={onClose} disabled={saving} className="px-3 py-2 text-xs text-gray-600">取消</button>
          <button type="button" onClick={save} disabled={saving} className="bg-szu-red px-4 py-2 text-xs font-medium text-white disabled:opacity-50">{saving ? "保存中…" : "保存分类"}</button>
        </footer>
      </section>
    </div>
  );
}
