export interface Article {
  id: string;
  title: string;
  url: string;
  section: string;
  publisher: string;
  publishDate: string;
  location: string | null;
  summary: string;
  category: string;
  matchedKeywords: string[];
  llmClassified: boolean;
  competitionMatch: string | null;
  favorite: boolean;
  crawledAt: number;
}

export interface CategoryDef {
  id: string;
  name: string;
  keywords: string[];
  isBuiltin: boolean;
  sortOrder: number;
}

export interface CrawlState {
  lastCrawlTime: number | null;
  lastCrawlStatus: "idle" | "crawling" | "success" | "partial" | "error" | "sso_expired";
  lastCrawlError: string | null;
  newArticleCount: number;
  totalArticleCount: number;
}

export interface Settings {
  deepseekApiKey: string;
  deepseekModel: string;
  subscriptions: string[];
}

export interface IndexEntry {
  id: string;
  category: string;
  publishDate: string;
  section: string;
  favorite: boolean;
}

export interface Competition {
  id: number;
  name: string;
  note: string;
}

export const BUILTIN_CATEGORIES: CategoryDef[] = [
  {
    id: "lecture",
    name: "讲座",
    keywords: ["讲座", "报告会", "学术报告", "研讨会", "讲堂", "演说", "沙龙", "论坛"],
    isBuiltin: true,
    sortOrder: 0,
  },
  {
    id: "activity",
    name: "活动",
    keywords: ["活动", "晚会", "演出", "开幕式", "闭幕式", "展览", "招新", "招募", "志愿者", "运动会", "文化节", "典礼", "仪式"],
    isBuiltin: true,
    sortOrder: 1,
  },
  {
    id: "competition",
    name: "比赛",
    keywords: ["比赛", "竞赛", "大赛", "选拔赛", "挑战赛", "竞技", "决赛", "初赛", "复赛", "答辩"],
    isBuiltin: true,
    sortOrder: 2,
  },
  {
    id: "academic",
    name: "教务",
    keywords: ["选课", "考试", "成绩", "学籍", "毕业", "学位", "论文", "答辩通知", "注册", "缴费", "奖学金", "助学金", "评优", "四六级", "普通话", "重修", "补考"],
    isBuiltin: true,
    sortOrder: 3,
  },
  {
    id: "news",
    name: "新闻",
    keywords: ["成功举办", "顺利开展", "落幕", "收官", "圆满举行", "顺利召开", "回顾", "发表论文", "发表文章", "发表成果"],
    isBuiltin: true,
    sortOrder: 4,
  },
  {
    id: "life",
    name: "生活",
    keywords: ["温馨提示", "天气", "荔枝", "防虫", "消杀"],
    isBuiltin: true,
    sortOrder: 5,
  },
  {
    id: "uncategorized",
    name: "待分类",
    keywords: [],
    isBuiltin: true,
    sortOrder: 99,
  },
];

export type Message =
  | { type: "crawl:start" }
  | { type: "crawl:status" }
  | { type: "notices:list"; category?: string; search?: string }
  | { type: "notice:update"; id: string; changes: Partial<Article> }
  | { type: "notice:favorite"; id: string; favorite: boolean }
  | { type: "notice:delete"; id: string }
  | { type: "notices:cleanup" }
  | { type: "categories:list" }
  | { type: "categories:save"; categories: CategoryDef[] }
  | { type: "settings:get" }
  | { type: "settings:save"; settings: Partial<Settings> }
  | { type: "check:sso" };

export type MessageResponse<T = void> = {
  success: true;
  data: T;
} | {
  success: false;
  error: string;
};
