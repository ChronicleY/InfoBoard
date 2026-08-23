import type { Article, IndexEntry } from "../types";

function articleKey(id: string): `articles:${string}` {
  return `articles:${id}`;
}

export async function getArticles(): Promise<Article[]> {
  const index = await chrome.storage.local.get("meta:index");
  const entries = (index["meta:index"] || []) as IndexEntry[];

  if (entries.length === 0) return [];

  const keys = entries.map((e) => articleKey(e.id));
  const result = await chrome.storage.local.get(keys);
  return keys.map((k) => result[k]).filter(Boolean) as Article[];
}

export async function getArticleIds(): Promise<string[]> {
  const result = await chrome.storage.local.get("meta:index");
  const entries = (result["meta:index"] || []) as IndexEntry[];
  return entries.map((e) => e.id);
}

export async function saveArticles(articles: Article[]): Promise<void> {
  const batch: Record<string, unknown> = {};

  for (const article of articles) {
    batch[articleKey(article.id)] = article;
  }

  // Rebuild index
  const index: IndexEntry[] = articles.map((a) => ({
    id: a.id,
    category: a.category,
    publishDate: a.publishDate,
    section: a.section,
    favorite: a.favorite,
  }));

  batch["meta:index"] = index;
  await chrome.storage.local.set(batch);
}

export async function updateArticle(id: string, changes: Partial<Article>): Promise<void> {
  const key = articleKey(id);
  const result = await chrome.storage.local.get(key);
  const article = result[key] as Article | undefined;
  if (!article) return;

  const updated = { ...article, ...changes };
  await chrome.storage.local.set({ [key]: updated });

  // Update index entry
  const indexRes = await chrome.storage.local.get("meta:index");
  const entries = (indexRes["meta:index"] || []) as IndexEntry[];
  const entryIdx = entries.findIndex((e) => e.id === id);
  if (entryIdx >= 0) {
    entries[entryIdx] = {
      ...entries[entryIdx],
      category: updated.category,
      favorite: updated.favorite,
    };
    await chrome.storage.local.set({ "meta:index": entries });
  }
}

export async function deleteArticles(ids: string[]): Promise<void> {
  await chrome.storage.local.remove(ids.map((id) => articleKey(id)));

  const indexRes = await chrome.storage.local.get("meta:index");
  const entries = (indexRes["meta:index"] || []) as IndexEntry[];
  const filtered = entries.filter((e) => !ids.includes(e.id));
  await chrome.storage.local.set({ "meta:index": filtered });
}

export async function getArticleExists(id: string): Promise<boolean> {
  const result = await chrome.storage.local.get(articleKey(id));
  return articleKey(id) in result;
}
