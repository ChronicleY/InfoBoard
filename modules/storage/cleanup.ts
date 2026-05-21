import { getArticles, deleteArticles } from "./notices";

export async function cleanupExpired(): Promise<number> {
  const articles = await getArticles();
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 7);

  const toDelete: string[] = [];

  for (const article of articles) {
    if (article.favorite) continue;
    const pubDate = new Date(article.publishDate);
    if (isNaN(pubDate.getTime()) || pubDate < cutoff) {
      toDelete.push(article.id);
    }
  }

  if (toDelete.length > 0) {
    await deleteArticles(toDelete);
  }

  return toDelete.length;
}
