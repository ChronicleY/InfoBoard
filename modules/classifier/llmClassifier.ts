import type { Article, CategoryDef } from "../types";

interface DeepSeekResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export interface LLMClassificationResult {
  category: string;
  shouldCreateCategory: boolean;
  keywords: string[];
}

export async function classifyWithLLM(
  article: Article,
  apiKey: string,
  model: string,
  apiUrl: string,
  categories: CategoryDef[],
): Promise<LLMClassificationResult> {
  const allCategories = categories
    .filter((c) => c.id !== "uncategorized")
    .map((c) => c.name);

  const url = apiUrl || "https://api.deepseek.com/chat/completions";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `你是深圳大学公文通分类助手。将通知归类为以下类别之一：
${allCategories.map((c) => `- ${c}`).join("\n")}

如果都不合适，可以建议创建一个新的短分类名。
只回复 JSON，不要解释。格式：
{"category":"分类名","shouldCreateCategory":false,"keywords":["关键词1","关键词2"]}

规则：
- 如果归入已有分类，shouldCreateCategory=false。
- 如果建议新分类，shouldCreateCategory=true，并给出 2-5 个可复用关键词。
- 如果无法判断，category="待分类", shouldCreateCategory=false。`,
        },
        {
          role: "user",
          content: `标题：${article.title}\n摘要：${article.summary}\n发布单位：${article.publisher}`,
        },
      ],
      max_tokens: 120,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
  }

  const data: DeepSeekResponse = await response.json();
  const content = data.choices[0]?.message?.content?.trim() ?? "";
  const parsed = parseLLMContent(content);

  if (allCategories.includes(parsed.category)) {
    return { ...parsed, shouldCreateCategory: false };
  }

  return parsed;
}

function parseLLMContent(content: string): LLMClassificationResult {
  const fallback: LLMClassificationResult = {
    category: "待分类",
    shouldCreateCategory: false,
    keywords: [],
  };

  if (!content) return fallback;

  try {
    const jsonText = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(jsonText) as Partial<LLMClassificationResult>;
    return {
      category: String(parsed.category || "待分类").trim(),
      shouldCreateCategory: Boolean(parsed.shouldCreateCategory),
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 5)
        : [],
    };
  } catch {
    return {
      category: content.replace(/^["']|["']$/g, "").trim() || "待分类",
      shouldCreateCategory: false,
      keywords: [],
    };
  }
}
