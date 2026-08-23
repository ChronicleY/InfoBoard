import type { CategoryDef } from "../types";

// Title keywords: any single match → 新闻
const NEWS_TITLE_KW = [
  "成功举办", "顺利开展", "圆满举行", "顺利召开",
  "圆满结束", "圆满成功", "圆满落幕", "完美收官",
  "落下帷幕", "精彩回顾", "成功举行", "顺利举办",
  "落幕", "收官", "回顾",
  "发表论文", "发表文章", "发表成果",
];

// Body signals for retrospective/report content
const NEWS_BODY_SIGNALS: RegExp[] = [
  // 时序叙事
  /首先.{1,20}(然后|接着|随后)/,
  /随后.{1,20}(最后|接着)/,
  /接着.{1,20}(随后|最后)/,
  // 报道用语
  /会上.{1,30}(表示|指出|强调|介绍)/,
  /据介绍/,
  /据了解/,
  /进行了.{1,20}(介绍|讲解|展示|分享|演示|交流)/,
  /开展了.{1,20}(活动|讲座|培训|交流|讨论)/,
  /举行了.{1,20}(仪式|典礼|讲座|报告|活动|比赛)/,
  // 完成态
  /圆满(结束|成功|落幕)/,
  /完美收官/,
  /落下帷幕/,
  // 回顾总结
  /活动总结/,
  /反响热烈/,
  /此次.{1,10}(活动|讲座|比赛|会议)/,
];

export function matchNewsKeywords(title: string, summary: string, publishDate?: string): string[] | null {
  const text = `${title} ${summary}`;

  // Title keyword match — strong signal
  const titleMatches = NEWS_TITLE_KW.filter((kw) => text.includes(kw));
  if (titleMatches.length > 0) return titleMatches;

  if (!isForwardLookingNotice(text)) {
    // Body signal match — need >= 2 signals from the body text patterns
    let bodyHits = 0;
    for (const re of NEWS_BODY_SIGNALS) {
      if (re.test(text)) {
        bodyHits++;
        if (bodyHits >= 2) return ["正文信号匹配"];
      }
    }
  }

  // Date signal — body mentions a date earlier than publish date → retrospective
  if (publishDate && matchNewsByDate(text, publishDate)) {
    return ["日期信号匹配"];
  }

  return null;
}

function isForwardLookingNotice(text: string): boolean {
  return /通知|安排|报名|评审会议|会议时间|考试安排|见面课|将于|请于|参会|参赛|按时参加|准时参加/.test(text);
}

/**
 * Detect retrospective articles by checking if the body mentions dates
 * earlier than the publish date.
 */
export function matchNewsByDate(bodyText: string, publishDate: string): boolean {
  const pub = parseDateString(publishDate);
  if (!pub) return false;

  if (isForwardLookingNotice(bodyText)) return false;

  const content = stripFooterDates(bodyText);

  // M月D日 / M月D号 patterns (no year — only check same year)
  const mdRegex = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g;
  let match: RegExpExecArray | null;
  while ((match = mdRegex.exec(content)) !== null) {
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;

    const candidate = new Date(pub.getFullYear(), month - 1, day);
    if (!isNaN(candidate.getTime()) && candidate < pub) return true;
  }

  // YYYY-MM-DD / YYYY/MM/DD patterns (year is explicit)
  const ymdRegex = /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/g;
  while ((match = ymdRegex.exec(content)) !== null) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;

    const candidate = new Date(year, month - 1, day);
    if (!isNaN(candidate.getTime()) && candidate < pub) return true;
  }

  return false;
}

function stripFooterDates(text: string): string {
  return text.replace(/[\s\S]{0,40}\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*$/g, "");
}

function parseDateString(dateStr: string): Date | null {
  if (!dateStr) return null;
  // Already ISO format from crawler
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

export function matchByKeywords(
  title: string,
  summary: string,
  categories: CategoryDef[],
): { category: CategoryDef; matchedKeywords: string[] } | null {
  const text = `${title} ${summary}`.toLowerCase();

  // Prefer the category with the longest matched keyword so specific terms
  // like "答辩通知" (教务) beat generic ones like "答辩" (比赛);
  // ties fall back to sortOrder.
  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);

  let best: { category: CategoryDef; matchedKeywords: string[]; score: number } | null = null;

  for (const category of sorted) {
    if (category.id === "uncategorized") continue;
    if (category.keywords.length === 0) continue;

    const matched = category.keywords.filter((kw) => text.includes(kw.toLowerCase()));
    if (matched.length === 0) continue;

    const longest = Math.max(...matched.map((kw) => kw.length));
    const score = longest * 100 + matched.length;
    if (!best || score > best.score) {
      best = { category, matchedKeywords: matched, score };
    }
  }

  return best ? { category: best.category, matchedKeywords: best.matchedKeywords } : null;
}
