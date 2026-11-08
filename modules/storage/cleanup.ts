import { getArticles, deleteArticles } from "./notices";
import { getSettings } from "./settings";

export async function cleanupExpired(): Promise<number> {
  const settings = await getSettings();
  const articles = await getArticles();
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (settings.storageDays || 7));

  const toDelete: string[] = [];

  for (const article of articles) {
    if (article.favorite) continue;
    const pubDate = new Date(article.publishDate);
    // Some detail pages omit publication time. Retain those articles based on
    // crawl time instead of deleting them immediately as invalid dates.
    const effectiveTime = Number.isNaN(pubDate.getTime())
      ? new Date(article.crawledAt)
      : pubDate;
    if (!Number.isNaN(effectiveTime.getTime()) && effectiveTime < cutoff) {
      toDelete.push(article.id);
    }
  }

  if (toDelete.length > 0) {
    await deleteArticles(toDelete);
  }

  return toDelete.length;
}
