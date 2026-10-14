import { BUILTIN_CATEGORIES } from "../types";
import { matchByKeywords, matchNewsKeywords } from "./keywordMatcher";
import { classifyWithLLM } from "./llmClassifier";
import { matchCompetition } from "./competitionMatcher";

export interface ClassifyInput {
  title: string;
  summary: string;
  publishDate: string;
  publisher: string;
}

export interface ClassifyResult {
  category: string;
  matchedKeywords: string[];
  competitionMatch: string | null;
  llmClassified: boolean;
  llmAttempted: boolean;
}

/**
 * Locate the BUILTIN category with the given display name and return the
 * keywords that hit. Used for the 公示 priority rule.
 */
export function matchNamedCategory(
  title: string,
  summary: string,
  name: string,
): string[] | null {
  const category = BUILTIN_CATEGORIES.find((c) => c.name === name);
  if (!category) return null;
  const text = `${title} ${summary}`.toLowerCase();
  const matched = category.keywords.filter((kw) => text.includes(kw.toLowerCase()));
  return matched.length > 0 ? matched : null;
}

/**
 * The synchronous, no-network part of the classification pipeline.
 * Order: 公示 → 新闻 → 通用关键词. Returns null when nothing matched.
 */
export function classifyByRules(input: ClassifyInput): ClassifyResult | null {
  const publicNotice = matchNamedCategory(input.title, input.summary, "公示");
  if (publicNotice) {
    return {
      category: "公示",
      matchedKeywords: publicNotice,
      competitionMatch: null,
      llmClassified: false,
      llmAttempted: false,
    };
  }

  const news = matchNewsKeywords(input.title, input.summary, input.publishDate);
  if (news) {
    return {
      category: "新闻",
      matchedKeywords: news,
      competitionMatch: null,
      llmClassified: false,
      llmAttempted: false,
    };
  }

  const keyword = matchByKeywords(input.title, input.summary, BUILTIN_CATEGORIES);
  if (keyword) {
    const category = keyword.category.name;
    return {
      category,
      matchedKeywords: keyword.matchedKeywords,
      competitionMatch: category === "比赛" ? matchCompetition(input.title, input.summary) : null,
      llmClassified: false,
      llmAttempted: false,
    };
  }

  return null;
}

/**
 * Full classification pipeline used by both the crawler and the reclassifier:
 * rules first, then the DeepSeek LLM as a fallback for uncategorized items.
 */
export async function classifyArticle(
  input: ClassifyInput,
  apiKey: string,
): Promise<ClassifyResult> {
  const ruleResult = classifyByRules(input);
  if (ruleResult) return ruleResult;

  if (!apiKey) {
    return {
      category: "待分类",
      matchedKeywords: [],
      competitionMatch: null,
      llmClassified: false,
      llmAttempted: false,
    };
  }

  try {
    const llmCategory: string = await classifyWithLLM(input, apiKey, BUILTIN_CATEGORIES);
    if (llmCategory !== "待分类") {
      return {
        category: llmCategory,
        matchedKeywords: [],
        competitionMatch: null,
        llmClassified: true,
        llmAttempted: true,
      };
    }
  } catch {
    /* stay 待分类 */
  }

  return {
    category: "待分类",
    matchedKeywords: [],
    competitionMatch: null,
    llmClassified: false,
    llmAttempted: true,
  };
}
