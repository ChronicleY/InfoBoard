import type { Article } from "../types";

export interface ArticlePreview {
  title: string;
  url: string;
  section: string;
  publisher: string;
  dateStr: string;
  location?: string;
  eventTime?: string;
  topic?: string;
  titleAttributes?: string;
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

  // Locate each <strong> section heading and its position.
  // The site nests a <font> tag inside <strong>, so capture any inner markup.
  const strongRegex = /<strong[^>]*>([\s\S]*?)<\/strong>/gi;
  const sections: { name: string; end: number }[] = [];
  let strongMatch: RegExpExecArray | null;

  while ((strongMatch = strongRegex.exec(html)) !== null) {
    const name = stripTags(strongMatch[1]).trim();
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

      const anchor = extractViewAnchor(rowContent);
      if (!anchor) continue;

      // Date is in the last <td> of the row
      const tdMatches = [...rowContent.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      const lastTd = tdMatches.length > 0 ? tdMatches[tdMatches.length - 1][1] : "";
      const dateStr = stripTags(lastTd).replace(/\s+/g, " ").trim();

      // Lecture rows carry 地点 in the anchor title attribute, e.g.
      // "时间：2026/8/24 10:00:00\n地点：粤海｜致知楼-706\n专题：..."
      let location: string | undefined;
      if (!location && anchor.location) location = anchor.location;
      // Fallback: visible text prefix like "粤海｜汇文楼｜..."
      if (!location) {
        const pipeParts = anchor.innerText.split("｜");
        if (pipeParts.length >= 3 && /^(粤海|丽湖|沧海|罗湖)/.test(pipeParts[0])) {
          location = `${pipeParts[0]}｜${pipeParts[1]}`;
        }
      }

      articles.push({
        title: anchor.title,
        url: anchor.url,
        section: section.name,
        publisher: "",
        dateStr,
        location,
        eventTime: anchor.eventTime,
        topic: anchor.topic,
        titleAttributes: anchor.attrTitle ?? undefined,
      });
    }
  }

  return articles;
}

/**
 * Extract the first view.asp link from an HTML fragment.
 * Prefers the full untruncated title from the anchor's title attribute
 * (the board truncates visible link text with "…"); falls back to inner text.
 */
function extractViewAnchor(fragment: string): {
  title: string;
  url: string;
  attrTitle: string | null;
  innerText: string;
  eventTime: string;
  location: string;
  topic: string;
} | null {
  const linkMatch =
    /<a[^>]*href\s*=\s*["']?([^"'\s>]*view\.asp[^"'\s>]*)["']?[^>]*>([\s\S]*?)<\/a>/i.exec(fragment);
  if (!linkMatch) return null;

  const href = linkMatch[1];
  const innerText = stripTags(linkMatch[2]).replace(/\s+/g, " ").trim();
  if (!innerText) return null;

  const attrRaw = /\stitle\s*=\s*["']([^"']*)["']/i.exec(linkMatch[0]);
  const attrTitle = attrRaw ? decodeEntities(attrRaw[1]).replace(/\r/g, "").trim() : "";
  const eventTime = /(?:时间|活动时间)[：:]\s*([^\n]+)/.exec(attrTitle)?.[1]?.trim() ?? "";
  const location = /地点[：:]\s*([^\n]+)/.exec(attrTitle)?.[1]?.trim() ?? "";
  const topic = /专题[：:]\s*([\s\S]*)$/.exec(attrTitle)?.[1]?.trim() ?? "";
  const plainAttributeTitle = attrTitle
    .split(/\r?\n/)
    .filter((line) => !/^(?:时间|活动时间|地点)[：:]/.test(line.trim()))
    .join(" ")
    .replace(/^专题[：:]\s*/, "")
    .trim();
  const title = topic || (plainAttributeTitle.length >= innerText.length ? plainAttributeTitle : innerText);

  const url = new URL(
    href.startsWith("/") ? href : `./${href}`,
    "https://www1.szu.edu.cn/board/",
  ).href;

  return { title, url, attrTitle: attrRaw ? attrTitle : null, innerText, eventTime, location, topic };
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
  eventDate: string | null;
  updatedAt: string | null;
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

  const bodyCell = extractArticleBodyCell(html);
  bodyText = extractBodyText(bodyCell);

  // Fallback: if no <p> tags found, try extracting from large <td> cells
  if (!publisher) {
    const infoText = extractInfoText(html);
    const { pub, date } = parseInfoLine(infoText);
    publisher = pub;
    publishDate = date;
  }

  if (!bodyText) {
    bodyText = extractBodyFallback(bodyCell || html);
  }

  const summary = bodyText.substring(0, 500);

  let location: string | null = null;
  const locMatch = bodyText.match(
    /(?:地点|地址|举办地点|活动地点|会议地点|讲座地点|授课地点|讲座地)[：:]\s*(.+?)(?:\n|$)/,
  );
  if (locMatch) location = locMatch[1].trim();

  const eventDateMatch = bodyText.match(/(?:活动|讲座|会议|考试|报名|举办)(?:时间|日期)[：:]\s*([^\n]{2,80})/);
  const updatedMatch = html.match(/(?:更新于|更新时间[：:]?\s*)(\d{4}[\/-]\d{1,2}[\/-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/);

  return {
    publisher: publisher || "未知发布单位",
    publishDate,
    location,
    summary,
    bodyText: bodyText.substring(0, 20000),
    eventDate: eventDateMatch?.[1]?.trim() ?? null,
    updatedAt: updatedMatch ? normalizeDate(updatedMatch[1]) || null : null,
  };
}

/**
 * Parse an infolist.asp page (category list).
 *
 * Row layout: index | location (title attr) | lecture time | title link | publisher | empty.
 * Note the date cell precedes the title cell here (unlike the main board).
 */
export function parseInfolistPage(html: string, section: string): ArticlePreview[] {
  const articles: ArticlePreview[] = [];

  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowContent = trMatch[1];

    const anchor = extractViewAnchor(rowContent);
    if (!anchor) continue;
    // Site-nav links point at root /view.asp?id=N; article links are under /board/
    if (!anchor.url.includes("/board/view.asp")) continue;

    const tdMatches = [...rowContent.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    let dateStr = "";
    let location: string | undefined;
    for (const td of tdMatches) {
      const text = stripTags(td[1]).replace(/\s+/g, " ").trim();
      if (!dateStr && /^\d{1,2}[/-]\d{1,2}(?:\s+\d{1,2}:\d{2})?$/.test(text)) {
        dateStr = text;
        continue;
      }
      if (!location) {
        const attrRaw = /\stitle\s*=\s*["']([^"']*)["']/i.exec(td[0]);
        if (attrRaw) {
          const m = decodeEntities(attrRaw[1]).match(/^(粤海|丽湖|沧海|罗湖)｜[^-－]+/);
          if (m) location = m[0];
        }
      }
    }

    articles.push({
      title: anchor.title,
      url: anchor.url,
      section,
      publisher: "",
      dateStr,
      location,
      eventTime: anchor.eventTime,
      topic: anchor.topic,
      titleAttributes: anchor.attrTitle ?? undefined,
    });
  }

  return articles;
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
  "讲": [0xBD, 0xB2], "座": [0xD7, 0xF9],
  "生": [0xC9, 0xFA], "活": [0xBB, 0xEE],
  "会": [0xBB, 0xE1], "议": [0xD2, 0xE9],
  "置": [0xD6, 0xC3], "顶": [0xB6, 0xA5],
};

// -- helpers --

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ""));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Format date parts directly — going through Date→toISOString shifts the day
// for posts before 08:00 local time (UTC+8).
function normalizeDate(raw: string): string {
  const cleaned = raw
    .replace(/[年月]/g, "-")
    .replace(/日/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const m = cleaned.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${pad2(Number(mo))}-${pad2(Number(d))}`;
  }
  return "";
}

/**
 * Parse the list-row date formats used by the board, e.g. "10/14", "10/15 9:30",
 * "2026/8/24". The board omits the year for recent rows, so it is inferred from
 * `now`; a month/day that is far enough ahead is assumed to belong to last year.
 */
export function parsePreviewDate(raw: string, now: Date = new Date()): Date | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})|(\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;

  if (m[1]) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return new Date(year, month - 1, day);
  }

  const month = Number(m[4]);
  const day = Number(m[5]);
  const hour = m[6] ? Number(m[6]) : 0;
  const minute = m[7] ? Number(m[7]) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  let year = now.getFullYear();
  const candidate = new Date(year, month - 1, day, hour, minute);
  // Tolerate up to ~1 month of future-dated events (e.g. upcoming lectures);
  // anything further ahead must belong to the previous year.
  const FUTURE_TOLERANCE = 32 * 24 * 60 * 60 * 1000;
  if (candidate.getTime() - now.getTime() > FUTURE_TOLERANCE) {
    year -= 1;
  }
  return new Date(year, month - 1, day, hour, minute);
}

/**
 * Keep dates from `days` ago through today (future-dated events are kept too).
 * Unknown dates are kept so we never silently drop an article.
 */
export function isWithinDays(date: Date | null, days: number, now: Date = new Date()): boolean {
  if (!date) return true;
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  cutoff.setDate(cutoff.getDate() - Math.max(0, days));
  return date.getTime() >= cutoff.getTime();
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
    if (/^(?:撰稿|审核|審核|更新时间|更新于|浏览记录|浏览日志)[：:]?/.test(text)) continue;
    if (/^（[^）]+）$/.test(text) && text.length < 30) continue;
    parts.push(text);
  }
  return parts.join("\n\n");
}

function extractArticleBodyCell(html: string): string {
  const tdRegex = /<td\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  const candidates: string[] = [];
  while ((match = tdRegex.exec(html)) !== null) {
    const attrs = match[0];
    if (!/\bheight\s*=\s*["']?300\b/i.test(attrs) || !/\bvalign\s*=\s*["']?top\b/i.test(attrs)) continue;
    candidates.push(extractBalancedTagContent(html, match.index + attrs.length, "td"));
  }
  return candidates.sort((a, b) => a.length - b.length).find((candidate) => candidate.trim()) ?? "";
}

function extractBalancedTagContent(html: string, contentStart: number, tagName: string): string {
  const tagRegex = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  tagRegex.lastIndex = contentStart;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(html)) !== null) {
    if (/^<\//.test(match[0])) depth--;
    else if (!/\/\s*>$/.test(match[0])) depth++;
    if (depth === 0) return html.substring(contentStart, match.index);
  }
  return html.substring(contentStart);
}

function extractBodyText(html: string): string {
  if (!html) return "";
  const cleanHtml = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const withBreaks = cleanHtml
    .replace(/<br\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/?(?:p|div|section|article|li|tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<\/?td\b[^>]*>/gi, "\n");
  return stripTags(withBreaks)
    .split(/\n+/)
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter((text) => text && !/^(?:撰稿|审核|審核|更新时间|更新于|浏览记录|浏览日志)[：:]?/.test(text))
    .join("\n\n");
}
