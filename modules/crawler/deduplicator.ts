import { getArticleIds } from "../storage/notices";

function hashUrl(url: string): string {
  // Simple hash from URL pathname + key query params
  try {
    const u = new URL(url);
    // Use the id param or the full pathname as the key
    const id = u.searchParams.get("id") || u.searchParams.get("nid") || u.searchParams.get("aid");
    if (id) return id;
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

export async function filterNewUrls(urls: { url: string }[]): Promise<{ url: string }[]> {
  const existingIds = new Set(await getArticleIds());
  return urls.filter((item) => {
    const id = hashUrl(item.url);
    return !existingIds.has(id);
  });
}

export function getArticleId(url: string): string {
  return hashUrl(url);
}
