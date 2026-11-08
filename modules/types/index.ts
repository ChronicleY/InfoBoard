export interface Article {
  id: string;
  title: string;
  url: string;
  section: string;
  publisher: string;
  publishDate: string;
  location: string | null;
  summary: string;
  bodyText?: string;
  eventTime?: string | null;
  eventDate?: string | null;
  updatedAt?: string | null;
  topic?: string | null;
  titleAttributes?: string | null;
  category: string;
  categoryId?: string;
  matchedKeywords: string[];
  classificationConfidence?: number;
  needsReview?: boolean;
  manuallyClassified?: boolean;
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
  aliases?: string[];
  addedAtRevision?: number;
}

export interface ClassifierTaxonomy {
  schemaVersion: 1;
  revision: number;
  categories: CategoryDef[];
  retiredCategoryIds: Record<string, string>;
}

export interface CrawlState {
  lastCrawlTime: number | null;
  lastCrawlStatus: "idle" | "crawling" | "success" | "partial" | "error" | "sso_expired";
  lastCrawlError: string | null;
  newArticleCount: number;
  totalArticleCount: number;
  processedCount: number;
  totalCount: number;
}

export interface Settings {
  userCollege: string;
  userCourses: string[];
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

export interface ClassifierLabelRecord {
  id: string;
  articleId: string;
  previousCategory: string;
  category: string;
  categoryId?: string;
  previousCategoryId?: string;
  correctedAt: number;
  source: "popup" | "csv-import" | "legacy-manual";
  article: Pick<Article,
    "url" | "title" | "summary" | "bodyText" | "section" | "publisher" | "location" | "eventTime" | "eventDate" | "updatedAt" | "topic" | "titleAttributes" | "publishDate"
  >;
}

export interface ClassifierStatus {
  modelVersion: number | null;
  previousModelVersion: number | null;
  labeledArticleCount: number;
  pendingLabelCount: number;
  categoryLabelCounts: Record<string, number>;
}

export interface ClassifierImportResult {
  imported: number;
  skippedBlank: number;
  duplicateIds: string[];
  invalidRows: number;
  invalidCategories: string[];
  unknownIds: string[];
}

export interface ClassifierModel {
  schemaVersion: 1;
  version: number;
  createdAt: number;
  trainedFrom: "bootstrap" | "manual-labels";
  algorithm: "tfidf-multinomial-naive-bayes";
  tokenizer: "intl-segmenter-domain-lexicon-v1";
  normalization: "nfkc-lowercase-zh-cn-v1";
  minimumTokenLength: number;
  stopWords: string[];
  audienceFeatureRules: {
    version: "graduate-audience-v1";
    graduatePatterns: string[];
    explicitGraduateOnlyPatterns: string[];
    mixedAudiencePatterns: string[];
    featureToken: string;
  };
  fieldNormalization?: {
    method: "inverse-sqrt-token-count-v1";
    minimumTokenCount: number;
  };
  categories: Array<{ id: string; name: string; sortOrder: number }>;
  fieldWeights: Record<string, number>;
  fieldLimits: Record<string, number>;
  lexicon: Array<{ token: string; categoryId: string; weight: number }>;
  alpha: number;
  vocabulary: string[];
  idf: Record<string, number>;
  classDocumentCounts: Record<string, number>;
  classTokenTotals: Record<string, number>;
  classTokenCounts: Record<string, Record<string, number>>;
  logPriors: Record<string, number>;
  labeledArticleCount: number;
  categoryLabelCounts: Record<string, number>;
  reviewThreshold: number;
  reviewMargin: number;
  newsFeatureRules?: {
    version: "retrospective-news-v1";
    datedLeadBoost: number;
    pastEventDateBoost: number;
    newCallPenalty?: number;
  };
  trainedLabelRecordIds?: string[];
}

export const BUILTIN_CATEGORIES: CategoryDef[] = [
  {
    id: "competition",
    name: "比赛竞赛",
    keywords: ["比赛", "竞赛", "大赛", "赛事", "选拔赛", "挑战赛", "决赛", "初赛", "复赛", "答辩赛"],
    isBuiltin: true,
    sortOrder: 0,
  },
  {
    id: "lecture",
    name: "讲座会议",
    keywords: ["讲座", "报告会", "学术报告", "研讨会", "讲堂", "沙龙", "论坛", "学术会议", "公开课"],
    isBuiltin: true,
    sortOrder: 1,
  },
  {
    id: "academic",
    name: "教务教学",
    keywords: ["选课", "考试", "成绩", "学籍", "毕业", "学位", "课程", "论文", "答辩", "注册", "四六级", "英语四级", "英语六级", "补考", "重修"],
    isBuiltin: true,
    sortOrder: 2,
  },
  {
    id: "research",
    name: "\u79d1\u7814\u6559\u5e08",
    keywords: ["课题", "项目申报", "基金", "科研", "自然科学基金", "社科基金", "立项", "结题", "研究项目", "科研项目", "实验室", "博士后"],
    isBuiltin: true,
    sortOrder: 3,
  },
  {
    id: "awards",
    name: "奖学金/评奖评优",
    keywords: ["奖学金", "助学金", "评奖", "评优", "优秀学生", "优秀毕业生", "荣誉称号", "拟推荐", "拟获奖", "奖项公示"],
    isBuiltin: true,
    sortOrder: 4,
  },
  {
    id: "recruitment",
    name: "招聘实习",
    keywords: ["招聘", "招录", "实习", "实习生", "就业", "校招", "宣讲会", "岗位", "应聘", "人才引进"],
    isBuiltin: true,
    sortOrder: 5,
  },
  {
    id: "campus-life",
    name: "校园生活",
    keywords: ["校园卡", "后勤", "停水", "停电", "图书馆", "宿舍", "食堂", "天气", "消杀", "校医院", "运动场"],
    isBuiltin: true,
    sortOrder: 6,
  },
  {
    id: "volunteer",
    name: "\u5fd7\u613f\u4e0e\u6d3b\u52a8",
    keywords: ["志愿服务", "志愿者", "志愿活动", "志愿招募", "义工", "公益服务", "志愿时长"],
    isBuiltin: true,
    sortOrder: 7,
  },
  {
    id: "international",
    name: "国际交流",
    keywords: ["国际交流", "出国交流", "海外交流", "交换生", "国际合作", "留学", "访问学者", "境外交流"],
    isBuiltin: true,
    sortOrder: 8,
  },
  {
    id: "news",
    name: "新闻",
    keywords: ["成功举办", "圆满落幕", "顺利开展", "活动回顾", "会议总结", "举行了", "举办了", "回顾", "报道"],
    isBuiltin: true,
    sortOrder: 9,
  },
  {
    id: "graduate",
    name: "研究生相关",
    keywords: ["研究生课程", "研究生考试", "研究生招生", "研究生培养", "研究生学位", "研究生毕业", "研究生论文答辩", "研究生选课"],
    isBuiltin: true,
    sortOrder: 10,
  },
  {
    id: "other",
    name: "其他",
    keywords: ["其他事项", "其它事项", "其他工作", "其它工作"],
    isBuiltin: true,
    sortOrder: 11,
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
  | { type: "notice:label"; id: string; category: string; categoryId?: string }
  | { type: "notice:favorite"; id: string; favorite: boolean }
  | { type: "notice:delete"; id: string }
  | { type: "notices:cleanup" }
  | { type: "categories:list" }
  | { type: "categories:save"; categories: CategoryDef[]; expectedRevision: number }
  | { type: "classifier:status" }
  | { type: "classifier:train" }
  | { type: "classifier:rollback" }
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
