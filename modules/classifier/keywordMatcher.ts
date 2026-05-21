import type { CategoryDef } from "../types";

export function matchByKeywords(
  title: string,
  summary: string,
  categories: CategoryDef[],
): { category: CategoryDef; matchedKeywords: string[] } | null {
  const text = `${title} ${summary}`.toLowerCase();

  // Sort by sortOrder so built-ins take priority over custom
  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const category of sorted) {
    if (category.id === "uncategorized") continue;
    if (category.keywords.length === 0) continue;

    const matched = category.keywords.filter((kw) => text.includes(kw.toLowerCase()));
    if (matched.length > 0) {
      return { category, matchedKeywords: matched };
    }
  }

  return null;
}
