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
  manuallyClassified?: boolean;
  llmAttempted?: boolean;
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
  userCollege: string;
  userCourses: string[];
  llmUrl: string;
  storageDays: number;
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
    keywords: ["讲座", "报告会", "学术报告", "研讨会", "讲堂", "演说", "沙龙", "论坛", "公开课"],
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
    keywords: ["选课", "考试", "成绩", "学籍", "毕业", "学位", "论文", "答辩", "答辩通知", "注册", "缴费", "奖学金", "助学金", "评优", "四六级", "普通话", "重修", "补考"],
    isBuiltin: true,
    sortOrder: 3,
  },
  {
    id: "announcement",
    name: "公示",
    keywords: ["公示期", "拟推荐"],
    isBuiltin: true,
    sortOrder: 4,
  },
  {
    id: "news",
    name: "新闻",
    keywords: ["成功举办", "顺利开展", "落幕", "收官", "圆满举行", "顺利召开", "回顾", "发表论文", "发表文章", "发表成果"],
    isBuiltin: true,
    sortOrder: 5,
  },
  {
    id: "research",
    name: "科研",
    keywords: ["研究生", "课题", "项目申报", "专项资金", "基金", "科研", "自然科学基金", "社科基金", "立项", "结题", "项目指南", "学术成果", "博士后", "研究项目", "科研项目", "成果奖", "实验室", "重点实验室", "横向项目", "纵向项目"],
    isBuiltin: true,
    sortOrder: 6,
  },
  {
    id: "life",
    name: "生活",
    keywords: ["温馨提示", "天气", "荔枝", "防虫", "消杀", "后勤", "信息中心", "宽带", "图书馆", "校园卡", "减脂", "跑步"],
    isBuiltin: true,
    sortOrder: 7,
  },
  {
    id: "uncategorized",
    name: "待分类",
    keywords: [],
    isBuiltin: true,
    sortOrder: 99,
  },
];

export const SZU_COLLEGES = [
  "教育学部",
  "艺术学部",
  "医学部",
  "马克思主义学院",
  "经济学院",
  "法学院",
  "心理学院",
  "体育学院",
  "人文学院",
  "外国语学院",
  "传播学院",
  "数学科学学院",
  "物理与光电工程学院",
  "化学与环境工程学院",
  "生命与海洋科学学院",
  "机电与控制工程学院",
  "材料学院",
  "电子与信息工程学院",
  "计算机与软件学院",
  "人工智能学院",
  "建筑与城市规划学院",
  "土木与交通工程学院",
  "管理学院",
  "政府管理学院",
  "高等研究院",
  "金融科技学院",
  "国际交流学院",
  "东京学院",
];

// Short forms mapping — used to catch mentions like "计软学院" or "电信学院"
export const COLLEGE_ALIASES: Record<string, string[]> = {
  "马克思主义学院": ["马院"],
  "外国语学院": ["外语学院", "外院"],
  "数学科学学院": ["数科院", "数学院"],
  "物理与光电工程学院": ["物光学院", "光电学院"],
  "化学与环境工程学院": ["化环学院", "化工学院"],
  "生命与海洋科学学院": ["生科院", "生海学院"],
  "机电与控制工程学院": ["机电学院"],
  "电子与信息工程学院": ["电信学院"],
  "计算机与软件学院": ["计软学院", "计科学院"],
  "建筑与城市规划学院": ["建规学院", "建筑学院"],
  "土木与交通工程学院": ["土木学院", "交工学院"],
  "政府管理学院": ["政管学院"],
  "国际交流学院": ["国际学院"],
};

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
