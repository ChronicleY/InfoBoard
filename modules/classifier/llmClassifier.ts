import type { Article, CategoryDef } from "../types";

interface DeepSeekResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export async function classifyWithLLM(
  article: Article,
  apiKey: string,
  model: string,
  categories: CategoryDef[],
): Promise<string> {
  const allCategories = categories
    .filter((c) => c.id !== "uncategorized")
    .map((c) => c.name);

  const response = await fetch("https://api.deepseek.com/chat/completions", {
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
          content: `你是深圳大学公文通分类助手。将以下通知标题归类为以下类别之一：
${allCategories.map((c) => `- ${c}`).join("\n")}

只回复类别名称，不要解释。`,
        },
        {
          role: "user",
          content: `标题：${article.title}\n摘要：${article.summary}\n发布单位：${article.publisher}`,
        },
      ],
      max_tokens: 10,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
  }

  const data: DeepSeekResponse = await response.json();
  const category = data.choices[0]?.message?.content?.trim() ?? "待分类";

  if (allCategories.includes(category)) return category;
  return "待分类";
}
