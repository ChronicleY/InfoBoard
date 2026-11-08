import { BUILTIN_CATEGORIES, type Article, type ClassifierModel } from "../types";
import type { CategoryDef } from "../types";

export type ClassifierText = Pick<Article,
  "title" | "summary" | "section" | "publisher" | "location" | "publishDate"
> & Partial<Pick<Article, "bodyText" | "eventTime" | "eventDate" | "updatedAt" | "topic" | "titleAttributes">>;

export interface LabeledClassifierText {
  articleId: string;
  category: string;
  categoryId?: string;
  labelRecordId?: string;
  article: ClassifierText;
}

export interface ClassificationResult {
  category: string;
  categoryId?: string;
  confidence: number;
  needsReview: boolean;
  matchedKeywords: string[];
  scores: Record<string, number>;
}

const FIELD_WEIGHTS: Record<string, number> = {
  title: 3.4,
  topic: 2.5,
  summary: 0.65,
  bodyText: 0.25,
  section: 0.2,
  publisher: 0.35,
  location: 0.45,
  eventTime: 0.25,
  eventDate: 0.35,
  titleAttributes: 0.15,
};

const FIELD_LIMITS: Record<string, number> = {
  title: 240,
  topic: 240,
  summary: 900,
  bodyText: 3600,
  section: 100,
  publisher: 100,
  location: 120,
  eventTime: 80,
  eventDate: 100,
  titleAttributes: 400,
};

const TERM_WEIGHTS: Record<string, Array<[string, number]>> = {
  competition: [["比赛", 1.6], ["竞赛", 2], ["大赛", 1.8], ["赛事", 1.4], ["选拔赛", 2], ["挑战赛", 2], ["决赛", 1.6], ["初赛", 1.6], ["复赛", 1.6], ["竞赛获奖", 2.2], ["建模竞赛", 2.2]],
  lecture: [["讲座", 2], ["讲学", 2], ["主讲人", 1.8], ["报告主题", 1.8], ["报告会", 1.8], ["学术报告", 2], ["研讨会", 2], ["学术会议", 2], ["论坛", 1.4], ["沙龙", 1.4], ["会议议程", 1.4]],
  academic: [["选课", 1.6], ["考试", 1.6], ["成绩", 1.4], ["学籍", 1.7], ["毕业", 1.4], ["学位", 1.4], ["课程", 1.3], ["四六级", 2], ["英语四级", 2], ["英语六级", 2], ["补考", 1.8], ["重修", 1.8], ["教学安排", 1.8]],
  research: [["课题", 1.5], ["项目申报", 2], ["科研项目", 2.2], ["科研", 1.5], ["自然科学基金", 2], ["社科基金", 2], ["立项", 1.6], ["结题", 1.6], ["实验室", 1.3], ["博士后", 1.4]],
  awards: [["奖学金", 2], ["助学金", 1.8], ["评奖", 2], ["评优", 1.8], ["优秀学生", 1.8], ["优秀毕业生", 2], ["荣誉称号", 1.6], ["拟推荐", 1.6], ["拟获奖", 1.8]],
  recruitment: [["招聘", 1.8], ["招录", 1.6], ["实习", 1.8], ["实习生", 1.8], ["就业", 1.4], ["校招", 1.8], ["宣讲会", 1.8], ["人才引进", 1.8]],
  "campus-life": [["校园文化节", 2], ["文化节", 1.5], ["校园卡", 1.8], ["后勤", 1.6], ["停水", 1.8], ["停电", 1.8], ["图书馆", 1.5], ["宿舍", 1.5], ["食堂", 1.5], ["校医院", 1.5], ["消杀", 1.4]],
  volunteer: [["志愿服务", 2], ["志愿者", 1.8], ["志愿活动", 2], ["志愿招募", 2], ["义工", 1.7], ["公益服务", 1.8], ["志愿时长", 2]],
  international: [["国际交流", 2], ["出国交流", 2], ["海外交流", 2], ["交换生", 1.8], ["国际合作", 1.5], ["留学", 1.6], ["访问学者", 1.5]],
  news: [["成功举办", 3.5], ["圆满落幕", 4], ["顺利开展", 3], ["活动回顾", 4], ["会议总结", 3.5], ["举行了", 3], ["举办了", 3], ["回顾", 2.4], ["报道", 1.2], ["斩获佳绩", 14], ["取得佳绩", 12], ["获奖喜报", 10]],
  graduate: [["研究生课程", 2.5], ["研究生英语课程", 3.2], ["研究生课程考试", 3.5], ["研究生考试", 2.5], ["研究生招生", 2.5], ["研究生培养", 2.3], ["研究生学位", 2.3], ["研究生毕业", 2.2], ["研究生论文答辩", 3.2], ["硕士学位论文答辩", 4.4], ["博士学位论文答辩", 4.4], ["研究生选课", 3.2], ["研究生奖学金", 2.8], ["博士研究生拔尖创新人才奖学金", 5], ["研究生奖学金评选", 4.2], ["拔尖创新人才", 2.8]],
  other: [["其他事项", 2], ["其它事项", 2], ["其他工作", 1.6], ["其它工作", 1.6]],
};

const STOP_WORDS = new Set([
  "关于", "有关", "通知", "公告", "深圳大学", "我校", "学校", "学院", "各单位", "各部门", "现将", "如下", "请于",
  "请各", "相关", "工作", "进行", "开展", "组织", "做好", "具体", "时间", "地点", "附件", "发布", "通知如下", "学者", "校园", "举办",
]);

const ALPHA = 0.35;
const MINIMUM_TOKEN_LENGTH = 2;
const TOKENIZER_ID = "intl-segmenter-domain-lexicon-v1" as const;
const NORMALIZATION_ID = "nfkc-lowercase-zh-cn-v1" as const;
const AUDIENCE_FEATURE_RULES: ClassifierModel["audienceFeatureRules"] = {
  version: "graduate-audience-v1",
  graduatePatterns: [
    "(?:研究生|硕士|博士)[^。；;，,、]{0,12}(?:课程|考试|选课|培养|学位|毕业|论文答辩|招生|奖学金|评奖|评优|讲座|会议)",
    "(?:硕士|博士)(?:研究生)?[^。；;，,、]{0,10}(?:学位论文答辩|论文答辩|学位答辩)",
    "(?:研究生|硕士研究生|博士研究生)[^。；;，,、]{0,12}(?:专属|仅限|面向)",
  ],
  explicitGraduateOnlyPatterns: [
    "(?:仅限|限于|只限|仅面向|只面向)[^。；;，,、\\n]{0,24}(?:硕士|博士)?研究生",
    "(?:参加对象|报名对象|招募对象|申请对象|申报对象|对象)[：:为是\\s]{0,6}[^。；;，,、\\n]{0,20}(?:硕士|博士)?研究生",
    "面向[^。；;，,、\\n]{0,12}(?:硕士|博士)?研究生(?:参加|报名|申请|开放)?",
  ],
  mixedAudiencePatterns: [
    "本科生[^。；;，,、]{0,32}(?:和|与|及|以及|、|及其)[^。；;，,、]{0,24}(?:研究生|硕士|博士)",
    "(?:研究生|硕士|博士)[^。；;，,、]{0,32}(?:和|与|及|以及|、)[^。；;，,、]{0,24}本科生",
    "(?:本科生|研究生)[^。；;，,、]{0,16}(?:共同参加|共同参与|面向全体学生|全校学生)",
  ],
  featureToken: "__graduate_exclusive__",
};
const GENERIC_GRADUATE_TOKENS = new Set(["研究生", "硕士研究生", "博士研究生", "硕士", "博士"]);
const REVIEW_THRESHOLD = 0.44;
const REVIEW_MARGIN = 0.1;
const FIELD_NORMALIZATION: ClassifierModel["fieldNormalization"] = {
  method: "inverse-sqrt-token-count-v1",
  minimumTokenCount: 1,
};
const CHINESE_SEQUENCE = /[\u3400-\u9fff]+/g;
const CJK_TOKEN = /^[\u3400-\u9fff]+$/;
const WORD_SEGMENTER = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("zh", { granularity: "word" })
  : null;

function cleanField(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength).replace(/\s+/g, " ").trim() : "";
}

function tokenize(text: string, stopWords: Set<string>, minimumLength: number): string[] {
  const normalized = text.toLocaleLowerCase("zh-CN").normalize("NFKC");
  if (WORD_SEGMENTER) {
    return Array.from(WORD_SEGMENTER.segment(normalized))
      .filter((part) => part.isWordLike)
      .map((part) => part.segment.trim())
      .filter((token) => Array.from(token).length >= minimumLength && !stopWords.has(token));
  }

  const result: string[] = [];
  const chars = Array.from(normalized);
  for (const char of chars) {
    if (!CJK_TOKEN.test(char)) continue;
    result.push(char);
  }
  for (const match of normalized.matchAll(CHINESE_SEQUENCE)) {
    const sequence = Array.from(match[0]);
    for (let i = 0; i < sequence.length - 1; i++) {
      result.push(sequence[i] + sequence[i + 1]);
    }
  }
  result.push(...(normalized.match(/[a-z0-9][a-z0-9._+-]*/g) ?? []));
  return result.filter((token) => Array.from(token).length >= minimumLength && !stopWords.has(token));
}

function buildLexicon(categories: CategoryDef[]) {
  const rows: Array<{ token: string; categoryId: string; weight: number }> = [];
  for (const category of categories) {
    for (const keyword of category.keywords) rows.push({ token: keyword, categoryId: category.id, weight: 1.5 });
    for (const [token, weight] of TERM_WEIGHTS[category.id] ?? []) {
      rows.push({ token, categoryId: category.id, weight });
    }
  }
  return rows;
}

const BOOTSTRAP_LEXICON = buildLexicon(BUILTIN_CATEGORIES);

type Vector = Map<string, number>;

function vectorize(
  article: ClassifierText,
  lexicon: ClassifierModel["lexicon"],
  fieldWeights: Record<string, number>,
  fieldLimits: Record<string, number>,
  stopWords: Set<string>,
  minimumTokenLength: number,
  audienceRules: ClassifierModel["audienceFeatureRules"],
  fieldNormalization?: ClassifierModel["fieldNormalization"],
): Vector {
  const fields: Array<[string, string]> = [
    ["title", cleanField(article.title, fieldLimits.title ?? 240)],
    ["topic", cleanField(article.topic, fieldLimits.topic ?? 240)],
    ["summary", cleanField(article.summary, fieldLimits.summary ?? 900)],
    // The lead is most useful: speaker biographies and footers occur later.
    ["bodyText", cleanField(article.bodyText, fieldLimits.bodyText ?? 3600)],
    ["section", cleanField(article.section, fieldLimits.section ?? 100)],
    ["publisher", cleanField(article.publisher, fieldLimits.publisher ?? 100)],
    ["location", cleanField(article.location, fieldLimits.location ?? 120)],
    ["eventTime", cleanField(article.eventTime, fieldLimits.eventTime ?? 80)],
    ["eventDate", cleanField(article.eventDate, fieldLimits.eventDate ?? 100)],
    ["titleAttributes", cleanField(article.titleAttributes, fieldLimits.titleAttributes ?? 400)],
  ];
  const vector: Vector = new Map();
  const preparedFields = fields.map(([field, value]) => {
    const tokens = value ? tokenize(value, stopWords, minimumTokenLength) : [];
    const minimumTokenCount = fieldNormalization?.minimumTokenCount ?? 1;
    const scale = fieldNormalization?.method === "inverse-sqrt-token-count-v1"
      ? (fieldWeights[field] ?? 1) / Math.sqrt(Math.max(tokens.length, minimumTokenCount))
      : fieldWeights[field] ?? 1;
    return { field, value, tokens, scale };
  });

  for (const { tokens, scale } of preparedFields) {
    for (const token of tokens) {
      if (GENERIC_GRADUATE_TOKENS.has(token)) continue;
      vector.set(token, (vector.get(token) ?? 0) + scale);
    }
  }

  const titleTopicSummary = preparedFields
    .filter(({ field }) => field === "title" || field === "topic" || field === "summary")
    .map(({ value }) => value)
    .join(" ");
  const titleTopicText = preparedFields
    .filter(({ field }) => field === "title" || field === "topic")
    .map(({ value }) => value)
    .join(" ");
  const bodyAudienceSections = (article.bodyText ?? "").match(/(?:参加对象|报名对象|招募对象|申请对象|申报对象|适用对象)[：:]?[^。；;\n]{0,100}/g) ?? [];
  const allAudienceText = preparedFields
    .filter(({ field }) => field === "title" || field === "topic" || field === "summary" || field === "bodyText")
    .map(({ value }) => value)
    .join(" ");
  const mixedAudienceText = `${titleTopicSummary} ${allAudienceText} ${bodyAudienceSections.join(" ")}`;
  const isMixedAudience = audienceRules.mixedAudiencePatterns.some((source) => new RegExp(source, "i").test(mixedAudienceText));
  const isGraduateExclusive = !isMixedAudience && (
    audienceRules.graduatePatterns.some((source) => new RegExp(source, "i").test(titleTopicText))
    || (audienceRules.explicitGraduateOnlyPatterns ?? []).some((source) => new RegExp(source, "i").test(allAudienceText))
  );
  if (isGraduateExclusive) vector.set(audienceRules.featureToken, (vector.get(audienceRules.featureToken) ?? 0) + 4.5);

  for (const entry of lexicon) {
    if (GENERIC_GRADUATE_TOKENS.has(entry.token)) continue;
    const keyword = entry.token.toLocaleLowerCase("zh-CN");
    const strongestFieldScale = preparedFields.reduce((strongest, field) =>
      field.value.toLocaleLowerCase("zh-CN").includes(keyword) ? Math.max(strongest, field.scale) : strongest, 0);
    if (strongestFieldScale > 0) {
      vector.set(entry.token, (vector.get(entry.token) ?? 0) + entry.weight * strongestFieldScale);
    }
  }
  return vector;
}

function bootstrapExamples(categories: CategoryDef[], lexicon: ClassifierModel["lexicon"]): LabeledClassifierText[] {
  return categories.map((category) => {
    const terms = lexicon
      .filter((entry) => entry.categoryId === category.id)
      .map((entry) => entry.token)
      .join(" ");
    return {
      articleId: `seed:${category.id}`,
      category: category.name,
      article: {
        title: category.id === "graduate" ? `研究生专属课程考试 ${terms}` : terms,
        summary: terms,
        bodyText: "",
        section: "",
        publisher: "",
        location: null,
        publishDate: "",
        eventTime: "",
        topic: "",
      },
    };
  });
}

export function trainClassifier(
  examples: LabeledClassifierText[],
  version = 1,
  categories: CategoryDef[] = BUILTIN_CATEGORIES,
  retiredCategoryIds: Record<string, string> = {},
): ClassifierModel {
  const categoryDefs = [...categories].sort((a, b) => a.id.localeCompare(b.id));
  const categoryLexicon = buildLexicon(categoryDefs);
  const labelCounts: Record<string, number> = Object.fromEntries(categoryDefs.map((category) => [category.id, 0]));
  const categoryById = new Map(categoryDefs.map((category) => [category.id, category]));
  const categoryByName = new Map(categoryDefs.map((category) => [category.name, category]));
  const categoryByAlias = new Map<string, CategoryDef>();
  for (const category of categoryDefs) {
    for (const alias of category.aliases ?? []) {
      if (!categoryByAlias.has(alias)) categoryByAlias.set(alias, category);
    }
  }
  const resolveCategory = (raw: string): CategoryDef | undefined => categoryById.get(raw) ?? categoryByName.get(raw) ?? categoryByAlias.get(raw);
  const validExamples = examples.filter((example) => {
    const id = example.categoryId ?? example.category;
    return Boolean(resolveCategory(id) ?? resolveCategory(example.category) ?? retiredCategoryIds[id]);
  });
  const documents = [...bootstrapExamples(categoryDefs, categoryLexicon), ...validExamples];
  const rawVectors = documents.map((example) => {
    const rawId = "categoryId" in example && example.categoryId ? example.categoryId : example.category;
    const categoryId = retiredCategoryIds[rawId]
      ? "other"
      : resolveCategory(rawId)?.id ?? resolveCategory(example.category)?.id ?? "other";
    if (!example.articleId.startsWith("seed:")) labelCounts[categoryId]++;
    return {
      categoryId,
      vector: vectorize(
        example.article,
        categoryLexicon,
        FIELD_WEIGHTS,
        FIELD_LIMITS,
        STOP_WORDS,
        MINIMUM_TOKEN_LENGTH,
        AUDIENCE_FEATURE_RULES,
        FIELD_NORMALIZATION,
      ),
    };
  });

  const documentFrequency = new Map<string, number>();
  for (const item of rawVectors) {
    for (const token of item.vector.keys()) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  const vocabulary = [...documentFrequency.keys()].sort();
  const idf: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const token of vocabulary) {
    idf[token] = Math.log((documents.length + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1;
  }

  const classDocumentCounts: Record<string, number> = Object.fromEntries(categoryDefs.map((category) => [category.id, 0]));
  const classTokenTotals: Record<string, number> = Object.fromEntries(categoryDefs.map((category) => [category.id, 0]));
  const classTokenCounts: Record<string, Record<string, number>> = Object.fromEntries(
    categoryDefs.map((category) => [category.id, Object.create(null) as Record<string, number>]),
  );
  for (const item of rawVectors) {
    classDocumentCounts[item.categoryId]++;
    for (const [token, tf] of item.vector) {
      const weight = tf * (idf[token] ?? 1);
      const tokenCounts = classTokenCounts[item.categoryId];
      tokenCounts[token] = (Object.hasOwn(tokenCounts, token) ? tokenCounts[token] : 0) + weight;
      classTokenTotals[item.categoryId] += weight;
    }
  }

  const docCount = rawVectors.length;
  const categoryCount = categoryDefs.length;
  const logPriors: Record<string, number> = {};
  for (const category of categoryDefs) {
    logPriors[category.id] = Math.log((classDocumentCounts[category.id] + ALPHA) / (docCount + ALPHA * categoryCount));
  }

  return {
    schemaVersion: 1,
    version,
    createdAt: Date.now(),
    trainedFrom: validExamples.length > 0 ? "manual-labels" : "bootstrap",
    algorithm: "tfidf-multinomial-naive-bayes",
    tokenizer: TOKENIZER_ID,
    normalization: NORMALIZATION_ID,
    fieldNormalization: { ...FIELD_NORMALIZATION! },
    minimumTokenLength: MINIMUM_TOKEN_LENGTH,
    stopWords: [...STOP_WORDS],
    audienceFeatureRules: {
      ...AUDIENCE_FEATURE_RULES,
      graduatePatterns: [...AUDIENCE_FEATURE_RULES.graduatePatterns],
      explicitGraduateOnlyPatterns: [...AUDIENCE_FEATURE_RULES.explicitGraduateOnlyPatterns],
      mixedAudiencePatterns: [...AUDIENCE_FEATURE_RULES.mixedAudiencePatterns],
    },
    categories: categoryDefs.map(({ id, name, sortOrder }) => ({ id, name, sortOrder })),
    fieldWeights: { ...FIELD_WEIGHTS },
    fieldLimits: { ...FIELD_LIMITS },
    lexicon: categoryLexicon.map((entry) => ({ ...entry })),
    alpha: ALPHA,
    vocabulary,
    idf,
    classDocumentCounts,
    classTokenTotals,
    classTokenCounts,
    logPriors,
    labeledArticleCount: validExamples.length,
    categoryLabelCounts: labelCounts,
    reviewThreshold: REVIEW_THRESHOLD,
    reviewMargin: REVIEW_MARGIN,
    newsFeatureRules: { version: "retrospective-news-v1", datedLeadBoost: 40, pastEventDateBoost: 1.8, newCallPenalty: -2.1 },
    trainedLabelRecordIds: validExamples.map((example) => example.labelRecordId).filter((id): id is string => Boolean(id)),
  };
}

export function classifyWithModel(article: ClassifierText, model: ClassifierModel): ClassificationResult {
  const vector = vectorize(
    article,
    model.lexicon,
    model.fieldWeights,
    model.fieldLimits,
    new Set(model.stopWords),
    model.minimumTokenLength,
    model.audienceFeatureRules,
    model.fieldNormalization,
  );
  const vocabSize = Math.max(1, model.vocabulary.length);
  const logScores: Record<string, number> = {};
  const knownFeatures = [...vector.keys()].filter((token) => Object.hasOwn(model.idf, token));

  if (knownFeatures.length === 0) {
    const other = model.categories.find((category) => category.id === "other");
    const category = other ?? model.categories[model.categories.length - 1];
    return {
      category: category?.name ?? "其他",
      categoryId: category?.id ?? "other",
      confidence: 0,
      needsReview: true,
      matchedKeywords: [],
      scores: {},
    };
  }

  for (const category of model.categories) {
    let score = model.logPriors[category.id] ?? Number.NEGATIVE_INFINITY;
    const classCounts = model.classTokenCounts[category.id] ?? {};
    const total = model.classTokenTotals[category.id] ?? 0;
    for (const [token, tf] of vector) {
      if (!Object.hasOwn(model.idf, token)) continue;
      const weightedTf = tf * model.idf[token];
      const count = Object.hasOwn(classCounts, token) ? classCounts[token] : 0;
      const termScore = weightedTf * Math.log((count + model.alpha) / (total + model.alpha * vocabSize));
      score += termScore;
    }
    logScores[category.id] = score;
  }

  const newsCategory = model.categories.find((category) => category.id === "news");
  if (newsCategory && model.newsFeatureRules) {
    const evidence = retrospectiveNewsEvidence(article);
    if (evidence.datedLead) logScores[newsCategory.id] += model.newsFeatureRules.datedLeadBoost;
    if (evidence.pastEventDate) logScores[newsCategory.id] += model.newsFeatureRules.pastEventDateBoost;
    if (evidence.newCall) logScores[newsCategory.id] += model.newsFeatureRules.newCallPenalty ?? 0;
  }

  const ranked = [...model.categories].sort((a, b) => logScores[b.id] - logScores[a.id] || a.id.localeCompare(b.id));
  const winner = ranked[0];
  const best = logScores[winner.id];
  const expScores = ranked.map((category) => Math.exp(Math.max(-700, logScores[category.id] - best)));
  const expTotal = expScores.reduce((sum, value) => sum + value, 0) || 1;
  const probabilities = Object.fromEntries(ranked.map((category, index) => [category.id, expScores[index] / expTotal]));
  const confidence = probabilities[winner.id] ?? 0;
  const margin = confidence - (probabilities[ranked[1]?.id] ?? 0);
  const runnerUp = ranked[1];
  const keywords = [...vector.entries()]
    .filter(([token]) => token !== model.audienceFeatureRules.featureToken && Object.hasOwn(model.idf, token))
    .map(([token, tf]) => {
      const idf = model.idf[token];
      const winnerCounts = model.classTokenCounts[winner.id] ?? {};
      const runnerCounts = runnerUp ? model.classTokenCounts[runnerUp.id] ?? {} : {};
      const winnerCount = Object.hasOwn(winnerCounts, token) ? winnerCounts[token] : 0;
      const runnerCount = Object.hasOwn(runnerCounts, token) ? runnerCounts[token] : 0;
      const winnerTotal = model.classTokenTotals[winner.id] ?? 0;
      const runnerTotal = runnerUp ? model.classTokenTotals[runnerUp.id] ?? 0 : 0;
      const weight = tf * idf;
      const winnerLikelihood = Math.log((winnerCount + model.alpha) / (winnerTotal + model.alpha * vocabSize));
      const runnerLikelihood = runnerUp
        ? Math.log((runnerCount + model.alpha) / (runnerTotal + model.alpha * vocabSize))
        : 0;
      return { token, evidence: weight * (winnerLikelihood - runnerLikelihood) };
    })
    .filter((item) => item.evidence > 0)
    .sort((a, b) => b.evidence - a.evidence)
    .slice(0, 8)
    .map((item) => item.token);

  return {
    category: winner.name,
    categoryId: winner.id,
    confidence,
    needsReview: confidence < model.reviewThreshold || margin < model.reviewMargin,
    matchedKeywords: keywords,
    scores: Object.fromEntries(model.categories.map((category) => [category.name, probabilities[category.id] ?? 0])),
  };
}

function retrospectiveNewsEvidence(article: ClassifierText): { datedLead: boolean; pastEventDate: boolean; newCall: boolean } {
  const lead = (article.summary || article.bodyText || "").split(/\n|[。！？]/, 1)[0].trim();
  const context = `${article.title} ${lead}`;
  const futureOrRecruitment = /(截止|截至|报名|申报|申请|将于|计划|预计|拟于|招聘|招募|征集|通知|报名启动|开放报名)/.test(context);
  const newCall = Boolean(futureOrRecruitment || /(上一期|往届|去年|此前|曾经|历史|回顾|重温)[^。]{0,24}(本期|本次|现招|現招)/.test(context));
  if (!lead || futureOrRecruitment) return { datedLead: false, pastEventDate: false, newCall };
  const openingDate = /^(?:((?:19|20)\d{2})年)?(\d{1,2})月(\d{1,2})日[，,、\s]/.exec(lead);
  const completedEvent = /(举行|召开|举办|开展|完成|结束|落幕|圆满|顺利|成功|闭幕|开幕|授予|颁发|发布|公布|获奖|斩获|夺得|取得)/.test(lead);
  const publish = parsePublicationDate(article.publishDate);
  const event = openingDate && publish
    ? (openingDate[1] ? validDate(Number(openingDate[1]), Number(openingDate[2]), Number(openingDate[3])) : inferEventDate(Number(openingDate[2]), Number(openingDate[3]), publish))
    : parseFullDate(article.eventDate ?? "");
  const datedLead = Boolean(openingDate && completedEvent && publish && event && event <= publish);
  const historicalQuote = /(上一期|往届|去年|此前|曾经|历史|回顾|重温)/.test(lead);
  const hasNewCall = /(本期|本次|現招|现招|报名|招募|征集|即将)/.test(`${article.title} ${lead}`);
  const pastEventDate = Boolean(publish && event && event < publish && completedEvent && !hasNewCall && !historicalQuote);
  return { datedLead, pastEventDate, newCall };
}

function parsePublicationDate(value: string): Date | null {
  const match = /((?:19|20)\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})/.exec(value);
  if (!match) return null;
  return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function parseFullDate(value: string): Date | null {
  const match = /((?:19|20)\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})/.exec(value);
  return match ? validDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function validDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function inferEventDate(month: number, day: number, publishDate: Date): Date | null {
  const year = publishDate.getFullYear();
  let date = validDate(year, month, day);
  if (!date) return null;
  if (date > publishDate && publishDate.getMonth() < 3) date = validDate(year - 1, month, day);
  return date;
}
