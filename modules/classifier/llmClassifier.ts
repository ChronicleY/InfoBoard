import type { Article, CategoryDef } from "../types";

const DS_URL = "https://api.deepseek.com/chat/completions";
const DS_MODEL = "deepseek-chat";

interface DeepSeekResponse {
  choices: Array<{
    message: { content: string };
  }>;
}

export async function classifyWithLLM(
  article: Article,
  apiKey: string,
  categories: CategoryDef[],
): Promise<string> {
  const allCategories = categories
    .filter((c) => c.id !== "uncategorized")
    .map((c) => c.name);

  const response = await fetch(DS_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DS_MODEL,
      messages: [
        {
          role: "system",
          content: `你是深圳大学公文通分类助手。根据公文标题和摘要，归入以下类别之一：
${allCategories.map((c) => `- ${c}`).join("\n")}

各分类含义：
- 讲座：学术报告、公开课、研讨会、论坛、沙龙、讲堂
- 活动：文艺演出、展览、招新、志愿者、运动会、文化节、典礼仪式
- 比赛：竞赛、大赛、选拔赛、挑战赛、答辩评比
- 教务：选课、考试、成绩、学籍、毕业、学位、论文、奖学金、助学金、评优
- 公示：拟推荐名单、拟获奖名单、公示期征求
- 新闻：活动回顾、赛事报道、会议总结、成果发表（已发生事件的报道）
- 科研：项目申报、基金、课题立项、结题、实验室、博士后
- 生活：后勤、校园卡、宽带、图书馆、体育健身、天气提醒

判断规则：
1. 公示优先 — 含"公示""拟推荐""拟获奖"即归公示
2. 新闻 = 已发生事件的报道，非未来活动通知
3. 信息不足时回复"待分类"

只回复类别名称，不解释。`,
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
    throw new Error(`DeepSeek API error: ${response.status}`);
  }

  const data: DeepSeekResponse = await response.json();
  const category = data.choices[0]?.message?.content?.trim() ?? "待分类";

  if (allCategories.includes(category)) return category;
  return "待分类";
}
