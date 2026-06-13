import { useState } from "react";
import type { Article, CategoryDef } from "../../../modules/types";

interface ReclassifyModalProps {
  article: Article;
  categories: CategoryDef[];
  onClose: () => void;
  onReclassified: () => void;
}

export default function ReclassifyModal({ article, categories, onClose, onReclassified }: ReclassifyModalProps) {
  const [selected, setSelected] = useState(article.category);

  const handleConfirm = async () => {
    await chrome.runtime.sendMessage({
      type: "notice:update",
      id: article.id,
      changes: { category: selected, matchedKeywords: [], manuallyClassified: true, llmClassified: false },
    });
    onReclassified();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-end justify-center z-20" onClick={onClose}>
      <div
        className="bg-white rounded-t-xl w-full max-h-[75%] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 pb-2">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">重新分类</h3>
          <p className="text-xs text-gray-500 truncate">{article.title}</p>
        </div>
        <div className="space-y-1 px-4 pb-2">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelected(cat.name)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                selected === cat.name
                  ? "bg-szu-red text-white"
                  : "bg-gray-50 text-gray-700 hover:bg-gray-100"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
        <div className="sticky bottom-0 bg-white border-t border-gray-100 flex gap-2 p-4">
          <button onClick={onClose} className="flex-1 py-2 text-xs rounded-md border border-gray-200 text-gray-600">
            取消
          </button>
          <button onClick={handleConfirm} className="flex-1 py-2 text-xs rounded-md bg-accent-blue text-white">
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
