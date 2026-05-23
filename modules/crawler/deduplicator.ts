import { getArticleIds } from "../storage/notices";

const DELETED_KEY = "meta:deletedIds";

function hashUrl(url: string): string {
  try {
    const u = new URL(url);
    const id = u.searchParams.get("id") || u.searchParams.get("nid") || u.searchParams.get("aid");
    if (id) return id;
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

export async function filterNewUrls(urls: { url: string }[]): Promise<{ url: string }[]> {
  const existingIds = new Set(await getArticleIds());
  const deletedIds = await getDeletedIds();
  return urls.filter((item) => {
    const id = hashUrl(item.url);
    return !existingIds.has(id) && !deletedIds.has(id);
  });
}

export function getArticleId(url: string): string {
  return hashUrl(url);
}

export async function addToDeletedIds(id: string): Promise<void> {
  const result = await chrome.storage.local.get(DELETED_KEY);
  const ids = (result[DELETED_KEY] || []) as string[];
  ids.push(id);
  // Keep only the last 500 entries to bound storage
  const trimmed = ids.length > 500 ? ids.slice(-500) : ids;
  await chrome.storage.local.set({ [DELETED_KEY]: trimmed });
}

export async function getDeletedIds(): Promise<Set<string>> {
  const result = await chrome.storage.local.get(DELETED_KEY);
  const ids = (result[DELETED_KEY] || []) as string[];
  return new Set(ids);
}
