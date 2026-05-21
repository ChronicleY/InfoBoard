import type { Article } from "../types";

interface ArticlePreview {
  title: string;
  url: string;
  section: string;
  publisher: string;
  dateStr: string;
}

export function parseBoardList(doc: Document, section: string): ArticlePreview[] {
  const articles: ArticlePreview[] = [];

  // Strategy 1: Look for table rows containing view.asp or content.asp links
  const rows = doc.querySelectorAll("tr");
  for (const row of rows) {
    const link = row.querySelector("a[href*='view.asp'], a[href*='content.asp'], a[href*='info']");
    if (!link) continue;

    const cells = row.querySelectorAll("td");
    const cellTexts = Array.from(cells).map((c) => c.textContent?.trim() ?? "");

    const title = link.textContent?.trim() ?? "";
    const href = link.getAttribute("href") ?? "";
    const url = new URL(href.startsWith("/") ? href : `/${href}`, "https://www1.szu.edu.cn").href;

    // Heuristic: publisher is typically in the 2nd-to-last or 3rd column, date in the last
    const publisher = cellTexts.length >= 3 ? cellTexts[cellTexts.length - 2] : "";
    const dateStr = cellTexts.length >= 1 ? cellTexts[cellTexts.length - 1] : "";

    if (title) {
      articles.push({ title, url, section, publisher, dateStr });
    }
  }

  return articles;
}

export function parseBoardDetail(doc: Document): {
  publisher: string;
  publishDate: string;
  location: string | null;
  summary: string;
  bodyText: string;
} {
  // Extract main content
  const body = doc.body.textContent ?? "";
  const cleanBody = body.replace(/\s+/g, " ").trim();

  // Try to find structured info
  let publisher = "";
  let publishDate = "";
  let location: string | null = null;

  // Search for metadata patterns in content tables or the body
  const allText = doc.body.textContent ?? "";

  // Extract department/unit
  const deptMatch = allText.match(/(?:发布单位|部门|单位)[：:]\s*(.+?)(?:\s|$)/i);
  if (deptMatch) publisher = deptMatch[1].trim();

  // Extract time
  const timeMatch = allText.match(/(?:时间|发布时间|日期)[：:]\s*(.+?)(?:\s|$)/i);
  if (timeMatch) publishDate = normalizeDate(timeMatch[1].trim());

  // Extract location
  const locMatch = allText.match(/(?:地点|地址|举办地点|活动地点)[：:]\s*(.+?)(?:\s|$)/i);
  if (locMatch) location = locMatch[1].trim();

  // Summary: first 500 chars of the body text, excluding navigation/header text
  const summary = cleanBody.substring(0, 500);

  return {
    publisher: publisher || "未知发布单位",
    publishDate: publishDate || formatToday(),
    location,
    summary,
    bodyText: cleanBody.substring(0, 2000),
  };
}

export function getPaginationUrls(doc: Document, baseUrl: string): string[] {
  const urls: string[] = [];
  const paginationLinks = doc.querySelectorAll("a[href*='page='], a[href*='Page='], a[href*='pn=']");

  if (paginationLinks.length === 0) return urls;

  let maxPage = 1;
  for (const link of paginationLinks) {
    const text = link.textContent?.trim() ?? "";
    const pageNum = parseInt(text, 10);
    if (!isNaN(pageNum) && pageNum > maxPage) {
      maxPage = pageNum;
    }
  }

  const base = new URL(baseUrl);
  for (let p = 2; p <= maxPage; p++) {
    base.searchParams.set("page", String(p));
    urls.push(base.toString());
  }

  return urls;
}

function normalizeDate(raw: string): string {
  // Handle various Chinese date formats: "2025年5月21日", "2025/05/21", "2025-05-21"
  let cleaned = raw.replace(/[年月]/g, "-").replace(/日/g, "").replace(/\s+/g, "");
  const date = new Date(cleaned);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split("T")[0];
  }
  return formatToday();
}

function formatToday(): string {
  return new Date().toISOString().split("T")[0];
}
