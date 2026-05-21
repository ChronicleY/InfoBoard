import type { Article } from "../types";

export interface ArticlePreview {
  title: string;
  url: string;
  section: string;
  publisher: string;
  dateStr: string;
  location?: string;
}

/**
 * Parse the board main page.
 *
 * The page uses a deeply nested table layout with 6 category panels
 * arranged in a 3×2 grid. Each panel has a <strong> heading followed by article rows.
 * Since MV3 service workers lack DOMParser, all parsing is regex/string-based.
 */
export function parseBoardList(html: string): ArticlePreview[] {
  const articles: ArticlePreview[] = [];

  // Locate each <strong> section heading and its position
  const strongRegex = /<strong[^>]*>([^<]+)<\/strong>/gi;
  const sections: { name: string; end: number }[] = [];
  let strongMatch: RegExpExecArray | null;

  while ((strongMatch = strongRegex.exec(html)) !== null) {
    const name = strongMatch[1].trim();
    if (isBoardSection(name)) {
      sections.push({ name, end: strongMatch.index + strongMatch[0].length });
    }
  }

  // For each section, extract links between its </strong> and the next <strong>
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const nextStart = i + 1 < sections.length
      ? html.indexOf("<strong", section.end)
      : html.length;
    const sectionHtml = html.substring(section.end, nextStart > 0 ? nextStart : html.length);

    // Match each <tr> row within this section's HTML
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowRegex.exec(sectionHtml)) !== null) {
      const rowContent = rowMatch[1];

      // Only rows containing view.asp links
      const linkMatch = /<a[^>]*href\s*=\s*["']?([^"'\s>]*view\.asp[^"'\s>]*)["']?[^>]*>([^<]*)<\/a>/i.exec(rowContent);
      if (!linkMatch) continue;

      const href = linkMatch[1];
      const title = linkMatch[2].trim();
      if (!title) continue;

      const url = new URL(
        href.startsWith("/") ? href : `./${href}`,
        "https://www1.szu.edu.cn/board/",
      ).href;

      // Date is in the last <td> of the row
      const tdMatches = [...rowContent.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      const lastTd = tdMatches.length > 0 ? tdMatches[tdMatches.length - 1][1] : "";
      const dateStr = stripTags(lastTd).trim();

      // Lecture items have location prefix: "粤海｜汇文楼｜..."
      let location: string | undefined;
      const pipeParts = title.split("｜");
      if (pipeParts.length >= 3 && /^(粤海|丽湖|沧海|罗湖)/.test(pipeParts[0])) {
        location = `${pipeParts[0]}｜${pipeParts[1]}`;
      }

      articles.push({ title, url, section: section.name, publisher: "", dateStr, location });
    }
  }

  return articles;
}

function isBoardSection(name: string): boolean {
  const known = [
    "教务教学", "科研动态", "党务行政", "学生工作", "学术讲座", "校园生活",
  ];
  return known.includes(name);
}

/**
 * Parse a board detail page (view.asp?id=XXXXX).
 *
 * Detail page has nested tables:
 *   outer table > row with "关闭窗口｜打印张贴版"
 *              > row with inner table:
 *                  row[0]: TITLE
 *                  row[1]: PUBLISHER DATE (WATERMARK)
 *                  row[2]+: CONTENT <p>...</p>
 *                  footer:  撰稿：WRITER 审核：REVIEWER
 *
 * All regex-based for MV3 service worker compatibility.
 */
export function parseBoardDetail(html: string): {
  publisher: string;
  publishDate: string;
  location: string | null;
  summary: string;
  bodyText: string;
} {
  let publisher = "";
  let publishDate = "";
  let bodyText = "";

  // Find the info row: a <td> with a datetime pattern and short text
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let tdMatch: RegExpExecArray | null;
  const dateTimeRe = /(\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s*\d{1,2}:\d{2}:\d{2})/;

  while ((tdMatch = tdRegex.exec(html)) !== null) {
    const text = stripTags(tdMatch[1]).trim();
    const dateMatch = text.match(dateTimeRe);
    if (dateMatch && text.length < 200) {
      // Remove watermark like （USER_NAME 1234567890）
      const clean = text.replace(/（[^）]+?\d{6,}[^）]*?）/, "").trim();
      publishDate = normalizeDate(dateMatch[1]);
      publisher = clean.substring(0, dateMatch.index!).trim();
      break;
    }
  }

  // Extract body from <p> tags
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pMatch: RegExpExecArray | null;
  const parts: string[] = [];

  while ((pMatch = pRegex.exec(html)) !== null) {
    const text = stripTags(pMatch[1]).trim();
    if (!text) continue;
    if (/^撰稿[：:]/.test(text)) continue;
    if (/^（[^）]+）$/.test(text) && text.length < 30) continue;
    if (bodyText.length + text.length > 2000) break;
    parts.push(text);
    bodyText = parts.join("\n\n");
  }

  // Fallback: if no <p> tags found, try extracting from large <td> cells
  if (!publisher) {
    const infoText = extractInfoText(html);
    const { pub, date } = parseInfoLine(infoText);
    publisher = pub;
    publishDate = date;
  }

  if (!bodyText) {
    bodyText = extractBodyFallback(html);
  }

  const summary = bodyText.substring(0, 500);

  let location: string | null = null;
  const locMatch = bodyText.match(
    /(?:地点|地址|举办地点|活动地点|会议地点|讲座地点|授课地点|讲座地)[：:]\s*(.+?)(?:\n|$)/,
  );
  if (locMatch) location = locMatch[1].trim();

  return {
    publisher: publisher || "未知发布单位",
    publishDate: publishDate || formatToday(),
    location,
    summary,
    bodyText: bodyText.substring(0, 2000),
  };
}

/**
 * Parse an infolist.asp page (category list with pagination).
 *
 * Structure: flat table rows with columns for index, category tag, title link, date.
 */
export function parseInfolistPage(html: string, section: string): ArticlePreview[] {
  const articles: ArticlePreview[] = [];

  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowContent = trMatch[1];

    const linkMatch = /<a[^>]*href\s*=\s*["']?([^"'\s>]*view\.asp[^"'\s>]*)["']?[^>]*>([^<]*)<\/a>/i.exec(rowContent);
    if (!linkMatch) continue;

    const href = linkMatch[1];
    const title = linkMatch[2].trim();
    if (!title) continue;

    const url = new URL(
      href.startsWith("/") ? href : `./${href}`,
      "https://www1.szu.edu.cn/board/",
    ).href;

    // Date in the last <td>
    const tdMatches = [...rowContent.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    const lastTd = tdMatches.length > 0 ? tdMatches[tdMatches.length - 1][1] : "";
    const dateStr = stripTags(lastTd).trim();

    articles.push({ title, url, section, publisher: "", dateStr });
  }

  return articles;
}

/**
 * Parse pagination links from an infolist page.
 */
export function getPaginationUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const bodyText = stripTags(html);

  const totalMatch = bodyText.match(/共\s*(\d+)\s*条/);
  if (!totalMatch) return urls;

  const totalRecords = parseInt(totalMatch[1], 10);
  const PAGE_SIZE = 20;

  if (totalRecords <= PAGE_SIZE) return urls;

  const totalPages = Math.ceil(totalRecords / PAGE_SIZE);
  const base = new URL(baseUrl);

  for (let p = 2; p <= Math.min(totalPages, 5); p++) {
    base.searchParams.set("page", String(p));
    urls.push(base.toString());
  }

  return urls;
}

/**
 * GBK-encode a string for use in URL query parameters.
 * The SZU board server expects GBK-encoded Chinese characters in URLs.
 */
export function gbkEncodeUrl(value: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
      continue;
    }
    const gbkBytes = GBK_MAP[value.charAt(i)];
    if (gbkBytes) {
      bytes.push(gbkBytes[0], gbkBytes[1]);
    }
  }

  return bytes.map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join("");
}

const GBK_MAP: Record<string, [number, number]> = {
  "教": [0xBD, 0xCC], "务": [0xCE, 0xF1],
  "科": [0xBF, 0xC6], "研": [0xD1, 0xD0],
  "行": [0xD0, 0xD0], "政": [0xD5, 0xFE],
  "学": [0xD1, 0xA7], "工": [0xB9, 0xA4],
  "讲": [0xBD, 0xB2], "座": [0xC5, 0xB7],
  "生": [0xC9, 0xFA], "活": [0xBB, 0xEE],
  "会": [0xBB, 0xE1], "议": [0xD2, 0xE9],
  "置": [0xD6, 0xC3], "顶": [0xB6, 0xA5],
};

export function getSectionFromInfotype(infotype: string): string {
  const map: Record<string, string> = {
    "教务": "教务教学",
    "科研": "科研动态",
    "行政": "党务行政",
    "学工": "学生工作",
    "讲座": "学术讲座",
    "生活": "校园生活",
    "会议": "会议通知",
    "置顶": "置顶推荐",
  };
  return map[infotype] ?? infotype;
}

// -- helpers --

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeDate(raw: string): string {
  const cleaned = raw
    .replace(/[年月]/g, "-")
    .replace(/日/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const date = new Date(cleaned);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split("T")[0];
  }
  const dateOnly = cleaned.match(/(\d{4}[\/-]\d{1,2}[\/-]\d{1,2})/);
  if (dateOnly) {
    const d = new Date(dateOnly[1]);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  return formatToday();
}

function formatToday(): string {
  return new Date().toISOString().split("T")[0];
}

function extractInfoText(html: string): string {
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;

  while ((match = tdRegex.exec(html)) !== null) {
    const text = stripTags(match[1]).trim();
    if (/\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s*\d{1,2}:\d{2}:\d{2}/.test(text) && text.length < 80) {
      return text;
    }
  }
  return "";
}

function parseInfoLine(text: string): { pub: string; date: string } {
  const clean = text.replace(/（[^）]+?\d{6,}[^）]*?）/, "").trim();
  const dateMatch = clean.match(/(\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s*\d{1,2}:\d{2}:\d{2})/);
  if (dateMatch) {
    return {
      pub: clean.substring(0, dateMatch.index).trim(),
      date: normalizeDate(dateMatch[1]),
    };
  }
  return { pub: clean, date: "" };
}

function extractBodyFallback(html: string): string {
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  const parts: string[] = [];

  while ((match = pRegex.exec(html)) !== null) {
    const text = stripTags(match[1]).trim();
    if (!text) continue;
    if (/^撰稿[：:]/.test(text)) continue;
    if (/^（[^）]+）$/.test(text) && text.length < 30) continue;
    parts.push(text);
  }
  return parts.join("\n\n");
}
