import type { CategoryDef } from "../types";

const NEWS_KEYWORDS = ["成功举办", "顺利开展", "落幕", "收官", "圆满举行", "顺利召开", "回顾", "发表论文", "发表文章", "发表成果"];

export function matchNewsKeywords(title: string, summary: string): string[] | null {
  const text = `${title} ${summary}`;
  const matched = NEWS_KEYWORDS.filter((kw) => text.includes(kw));
  return matched.length > 0 ? matched : null;
}

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
