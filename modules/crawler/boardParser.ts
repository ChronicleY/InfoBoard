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
 * arranged in a 3×2 grid: 教务教学, 科研动态, 党务行政, 学生工作, 学术讲座, 校园生活.
 * Each panel has a <strong> heading followed by 10 article rows.
 *
 * Lecture articles (学术讲座) use /board/view.asp?id=XXXXX URLs and include
 * campus/building prefix in the title like "粤海｜汇文楼｜...".
 */
export function parseBoardList(doc: Document): ArticlePreview[] {
  const articles: ArticlePreview[] = [];

  const strongEls = doc.querySelectorAll("strong");
  for (const strong of strongEls) {
    const section = strong.textContent?.trim() ?? "";
    if (!isBoardSection(section)) continue;

    // Each category panel is a <td> containing the <strong> heading and an article list table
    const containerTd = strong.closest("td");
    if (!containerTd) continue;

    const links = containerTd.querySelectorAll("a[href*='view.asp']");
    for (const link of links) {
      const title = link.textContent?.trim() ?? "";
      const href = link.getAttribute("href") ?? "";
      if (!title || !href) continue;

      // Resolve relative to the board page. Most links are "view.asp?id=XXXXX" (relative)
      // but lecture links are "/board/view.asp?id=XXXXX" (absolute with /board/ prefix).
      const url = new URL(
        href.startsWith("/") ? href : `./${href}`,
        "https://www1.szu.edu.cn/board/",
      ).href;

      // Date is in the last <td> of the same row
      const row = link.closest("tr");
      const cells = row?.querySelectorAll("td");
      const dateStr = cells?.length
        ? (cells[cells.length - 1]?.textContent?.trim() ?? "")
        : "";

      // Lecture items have location prefix in the title: "粤海｜汇文楼｜..."
      let location: string | undefined;
      const pipeParts = title.split("｜");
      if (pipeParts.length >= 3 && /^(粤海|丽湖|沧海|罗湖)/.test(pipeParts[0])) {
        location = `${pipeParts[0]}｜${pipeParts[1]}`;
      }

      articles.push({
        title,
        url,
        section,
        publisher: "",
        dateStr,
        location,
      });
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
 * Parse a board detail page (view.asp?id=XXXXX or /board/view.asp?id=XXXXX).
 *
 * Detail page has nested tables:
 *   outer table > row with "关闭窗口｜打印张贴版"
 *              > row with inner table:
 *                  row[0]: TITLE
 *                  row[1]: PUBLISHER DATE (USER_WATERMARK)
 *                  row[2]: CONTENT <p>...</p>
 *                  row[4]: 撰稿：WRITER 审核：REVIEWER
 */
export function parseBoardDetail(doc: Document): {
  publisher: string;
  publishDate: string;
  location: string | null;
  summary: string;
  bodyText: string;
} {
  let publisher = "";
  let publishDate = "";
  let bodyText = "";

  // Navigate: close link → outer table → first nested table (inner table)
  const closeLink = doc.querySelector("a[href*='window.close']");
  const outerTable = closeLink?.closest("table");
  const innerTable = outerTable?.querySelector("table");

  if (innerTable) {
    const rows = innerTable.querySelectorAll("tr");

    for (let i = 0; i < rows.length; i++) {
      const text = rows[i]?.textContent?.trim() ?? "";
      if (!text) continue;

      // Row 0: title (skip, we already have it from the list page)
      if (i === 0) continue;

      // Row 1: publisher + date + watermark
      if (i === 1) {
        const infoText = text.replace(/（[^）]+?\d{6,}[^）]*?）/, "").trim();
        const dateMatch = infoText.match(/(\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s*\d{1,2}:\d{2}:\d{2})/);
        if (dateMatch) {
          publishDate = normalizeDate(dateMatch[1]);
          publisher = infoText.substring(0, dateMatch.index).trim();
        }
        continue;
      }

      // Remaining rows: content with <p> elements or plain text
      // Skip footer row (撰稿/审核)
      const cellText = rows[i]?.textContent?.trim() ?? "";
      if (/^撰稿[：:]/.test(cellText)) continue;

      if (bodyText.length < 2000) {
        const paragraphs = rows[i]?.querySelectorAll("p") ?? [];
        for (const p of paragraphs) {
          const pText = p.textContent?.trim() ?? "";
          if (pText) {
            bodyText += (bodyText ? "\n\n" : "") + pText;
          }
        }
        // If no <p> tags, use cell text directly
        if (paragraphs.length === 0 && cellText) {
          bodyText += (bodyText ? "\n\n" : "") + cellText;
        }
      }
    }
  }

  // Fallback: if the close-link approach didn't work
  if (!publisher) {
    const infoText = extractInfoText(doc);
    const { pub, date } = parseInfoLine(infoText);
    publisher = pub;
    publishDate = date;
  }

  if (!bodyText) {
    bodyText = extractBodyFallback(doc);
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
 *   <tr>
 *     <td align="center" height="32px">1</td>
 *     <td align="center"><a href="?infotype=教务">教务</a></td>
 *     <td align="center">...</td>
 *     <td><a href="view.asp?id=XXXXX">TITLE</a></td>
 *     <td>DATE</td>
 *   </tr>
 */
export function parseInfolistPage(doc: Document, section: string): ArticlePreview[] {
  const articles: ArticlePreview[] = [];

  const rows = doc.querySelectorAll("tr");
  for (const row of rows) {
    const link = row.querySelector("a[href*='view.asp']");
    if (!link) continue;

    const href = link.getAttribute("href") ?? "";
    const title = link.textContent?.trim() ?? "";
    if (!title || !href) continue;

    const url = new URL(
      href.startsWith("/") ? href : `./${href}`,
      "https://www1.szu.edu.cn/board/",
    ).href;

    const cells = row.querySelectorAll("td");
    const dateStr = cells.length > 0
      ? (cells[cells.length - 1]?.textContent?.trim() ?? "")
      : "";

    articles.push({ title, url, section, publisher: "", dateStr });
  }

  return articles;
}

/**
 * Parse pagination links from an infolist page.
 *
 * Pagination uses form submission via javascript.
 * We extract page URLs by modifying the infotype parameter with &page=N.
 */
export function getPaginationUrls(doc: Document, baseUrl: string): string[] {
  const urls: string[] = [];
  const bodyText = doc.body.textContent ?? "";

  // Try to find total records and page size
  const totalMatch = bodyText.match(/共\s*(\d+)\s*条/);
  if (!totalMatch) return urls;

  const totalRecords = parseInt(totalMatch[1], 10);
  const PAGE_SIZE = 20; // infolist shows ~20 items per page

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
    // ASCII passthrough
    if (code < 0x80) {
      bytes.push(code);
      continue;
    }
    // Use encodeURIComponent to get UTF-8 bytes, then map to a known set
    // For the infotype values we need, use a hardcoded map
    const gbkBytes = GBK_MAP[value.charAt(i)];
    if (gbkBytes) {
      bytes.push(gbkBytes[0], gbkBytes[1]);
    }
  }

  return bytes.map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join("");
}

// GBK encoding for the specific Chinese characters used in infotype URLs
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
  // Try matching just the date part
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

function extractInfoText(doc: Document): string {
  // Try all <td> cells — the info line contains a date pattern
  const tds = doc.querySelectorAll("td");
  for (const td of tds) {
    const text = td.textContent?.trim() ?? "";
    if (/\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s*\d{1,2}:\d{2}:\d{2}/.test(text) && text.length < 80) {
      return text;
    }
  }
  return "";
}

function parseInfoLine(text: string): { pub: string; date: string } {
  // Remove watermark
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

function extractBodyFallback(doc: Document): string {
  // Collect all <p> content, skipping footers and single-char paragraphs
  const paragraphs = doc.querySelectorAll("p");
  const parts: string[] = [];
  for (const p of paragraphs) {
    const text = p.textContent?.trim() ?? "";
    if (!text) continue;
    if (/^撰稿[：:]/.test(text)) continue;
    if (/^（[^）]+）$/.test(text) && text.length < 30) continue;
    parts.push(text);
  }
  return parts.join("\n\n");
}
