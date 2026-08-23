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
      const locAttr = anchor.attrTitle?.match(/地点：([^\n]+)/);
      if (locAttr) {
        const locMatch = locAttr[1].match(/^(粤海|丽湖|沧海|罗湖)｜[^-－]+/);
        if (locMatch) location = locMatch[0];
      }
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
} | null {
  const linkMatch =
    /<a[^>]*href\s*=\s*["']?([^"'\s>]*view\.asp[^"'\s>]*)["']?[^>]*>([\s\S]*?)<\/a>/i.exec(fragment);
  if (!linkMatch) return null;

  const href = linkMatch[1];
  const innerText = stripTags(linkMatch[2]).replace(/\s+/g, " ").trim();
  if (!innerText) return null;

  const attrRaw = /\stitle\s*=\s*["']([^"']*)["']/i.exec(linkMatch[0]);
  let attrTitle = attrRaw ? decodeEntities(attrRaw[1]).replace(/\s+/g, " ").trim() : "";
  // Lecture anchors: "时间：… 地点：… 专题：<real title>"
  const zhuanTi = attrTitle.lastIndexOf("专题：");
  if (zhuanTi >= 0) attrTitle = attrTitle.substring(zhuanTi + "专题：".length).trim();

  const title = attrTitle.length >= innerText.length ? attrTitle : innerText;

  const url = new URL(
    href.startsWith("/") ? href : `./${href}`,
    "https://www1.szu.edu.cn/board/",
  ).href;

  return { title, url, attrTitle: attrRaw ? attrTitle : null, innerText };
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

    articles.push({ title: anchor.title, url: anchor.url, section, publisher: "", dateStr, location });
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
  return formatToday();
}

function formatToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
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
