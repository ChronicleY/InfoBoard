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

export function matchNewsKeywords(title: string, summary: string): string[] | null {
  const text = `${title} ${summary}`;

  // Title keyword match — strong signal
  const titleMatches = NEWS_TITLE_KW.filter((kw) => text.includes(kw));
  if (titleMatches.length > 0) return titleMatches;

  // Body signal match — need >= 2 signals from the body text patterns
  let bodyHits = 0;
  for (const re of NEWS_BODY_SIGNALS) {
    if (re.test(text)) {
      bodyHits++;
      if (bodyHits >= 2) return ["正文信号匹配"];
    }
  }

  return null;
}

export function matchByKeywords(
  title: string,
  summary: string,
  categories: CategoryDef[],
): { category: CategoryDef; matchedKeywords: string[] } | null {
  const text = `${title} ${summary}`.toLowerCase();

  // Sort by sortOrder so built-ins take priority over custom
  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const category of sorted) {
    if (category.id === "uncategorized") continue;
    if (category.keywords.length === 0) continue;

    const matched = category.keywords.filter((kw) => text.includes(kw.toLowerCase()));
    if (matched.length > 0) {
      return { category, matchedKeywords: matched };
    }
  }

  return null;
}
