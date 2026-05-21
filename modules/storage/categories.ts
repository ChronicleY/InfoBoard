import type { CategoryDef } from "../types";
import { BUILTIN_CATEGORIES } from "../types";

export async function getCategories(): Promise<CategoryDef[]> {
  const result = await chrome.storage.local.get("categories:custom");
  const custom = (result["categories:custom"] || []) as CategoryDef[];
  const builtInMap = new Map(BUILTIN_CATEGORIES.map((c) => [c.id, c]));

  // Load saved keyword edits for built-in categories
  const saved = await chrome.storage.local.get("categories:builtin");
  const savedBuiltins: Record<string, string[]> = saved["categories:builtin"] || {};

  const builtins = BUILTIN_CATEGORIES.map((c) => ({
    ...c,
    keywords: savedBuiltins[c.id] ?? c.keywords,
  }));

  return [...builtins, ...custom].sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function saveCustomCategories(categories: CategoryDef[]): Promise<void> {
  await chrome.storage.local.set({ "categories:custom": categories });
}

export async function saveBuiltinKeywords(builtinKeywords: Record<string, string[]>): Promise<void> {
  await chrome.storage.local.set({ "categories:builtin": builtinKeywords });
}
