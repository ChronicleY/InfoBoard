import type { CategoryDef } from "../../../modules/types";

interface CategoryTabsProps {
  categories: CategoryDef[];
  counts: Record<string, number>;
  totalCount: number;
  active: string;
  onSelect: (category: string) => void;
}

export default function CategoryTabs({ categories, counts, totalCount, active, onSelect }: CategoryTabsProps) {
  return (
    <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto shrink-0">
      <Tab key="all" label="全部" count={totalCount} active={active === "all"} onClick={() => onSelect("all")} />
      {categories
        .filter((c) => c.id !== "uncategorized" || (counts[c.name] ?? 0) > 0)
        .map((cat) => (
          <Tab
            key={cat.id}
            label={cat.name}
            count={counts[cat.name] ?? 0}
            active={active === cat.name}
            onClick={() => onSelect(cat.name)}
          />
        ))}
    </div>
  );
}

function Tab({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
        active
          ? "bg-szu-red text-white"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      }`}
    >
      {label}
      {count > 0 && (
        <span className={`ml-1 px-1 py-0 rounded text-[10px] ${active ? "bg-white/20" : "bg-gray-300"}`}>
          {count}
        </span>
      )}
    </button>
  );
}
