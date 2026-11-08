import { useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import type { CategoryDef } from "../../../modules/types";

interface CategoryTabsProps {
  categories: CategoryDef[];
  counts: Record<string, number>;
  totalCount: number;
  favoriteCount: number;
  active: string;
  onSelect: (category: string) => void;
  onReorder: (categories: CategoryDef[]) => void;
}

export default function CategoryTabs({ categories, counts, totalCount, favoriteCount, active, onSelect, onReorder }: CategoryTabsProps) {
  const [order, setOrder] = useState(categories);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragged = useRef(false);
  useEffect(() => setOrder(categories), [categories]);

  useEffect(() => {
    if (!draggingId) return;
    const move = (event: PointerEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-category-tab-id]");
      const overId = target?.dataset.categoryTabId;
      if (!overId || overId === draggingId) return;
      setOrder((items) => {
        const from = items.findIndex((item) => item.id === draggingId);
        const to = items.findIndex((item) => item.id === overId);
        if (from < 0 || to < 0 || from === to) return items;
        const next = [...items];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        return next;
      });
    };
    const end = () => {
      setDraggingId(null);
      if (order.some((item, index) => item.id !== categories[index]?.id)) onReorder(order);
    };
    const cancel = () => {
      setDraggingId(null);
      setOrder(categories);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [draggingId, onReorder, order, categories]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const tabProps = (category: CategoryDef) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (timer.current) clearTimeout(timer.current);
      event.currentTarget.setPointerCapture(event.pointerId);
      timer.current = setTimeout(() => {
        dragged.current = true;
        setDraggingId(category.id);
      }, 300);
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setDraggingId(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onClick: () => {
      if (dragged.current) {
        dragged.current = false;
        return;
      }
      onSelect(category.id);
    },
  });

  return (
    <div className="max-h-24 shrink-0 overflow-y-auto border-b border-gray-100 px-3 py-2">
      <div className="flex flex-wrap gap-1.5">
      <Tab key="favorites" label="收藏" count={favoriteCount} active={active === "favorites"} onClick={() => onSelect("favorites")} />
      <Tab key="all" label="全部" count={totalCount} active={active === "all"} onClick={() => onSelect("all")} />
      {order.map((cat) => (
          <Tab
            key={cat.id}
            categoryTabId={cat.id}
            label={cat.name}
            count={counts[cat.id] ?? 0}
            active={active === cat.id}
            className={draggingId === cat.id ? "border-szu-red bg-red-50" : ""}
            {...tabProps(cat)}
          />
        ))}
      </div>
    </div>
  );
}

function Tab({ label, count, active, onClick, className = "", categoryTabId, onPointerDown, onPointerUp, onPointerCancel }: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  className?: string;
  categoryTabId?: string;
  onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel?: (event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      onClick={onClick}
      data-category-tab-id={categoryTabId}
      title={categoryTabId ? `${label} · 长按拖动排序` : undefined}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={`${className} max-w-full shrink-0 whitespace-normal break-words border px-2 py-1 text-left text-[11px] font-medium transition-colors ${
        active
          ? "border-szu-red bg-szu-red text-white"
          : "border-gray-200 bg-white text-gray-600 hover:border-gray-400"
      }`}
    >
      {categoryTabId && <GripVertical className="mr-0.5 inline-block align-text-bottom text-gray-400" size={12} aria-hidden="true" />}
      {label}
      {count > 0 && (
        <span className={`ml-1 px-1 py-0 text-[10px] ${active ? "bg-white/20" : "bg-gray-100"}`}>
          {count}
        </span>
      )}
    </button>
  );
}
