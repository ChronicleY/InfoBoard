import assert from "node:assert/strict";
import { classifyWithModel, trainClassifier, type ClassifierText } from "../modules/classifier/naiveBayes";

const model = trainClassifier([], 1);
const cases: Array<{ name: string; title: string; body: string; published: string; news: boolean }> = [
  {
    name: "dated retrospective lead",
    title: "校企交流座谈会",
    body: "10月30日，学校召开校企交流座谈会。会上双方围绕人才培养进行了交流，并签署了合作协议。",
    published: "2026-11-02",
    news: true,
  },
  {
    name: "year boundary retrospective",
    title: "校企交流座谈会",
    body: "12月30日，学校召开校企交流座谈会。会上双方进行了交流，并签署了合作协议。",
    published: "2027-01-02",
    news: true,
  },
  {
    name: "same day completed event",
    title: "交流活动回顾",
    body: "11月2日，学校举行了交流活动。与会人员进行了深入交流。",
    published: "2026-11-02",
    news: true,
  },
  {
    name: "expired registration deadline is not news",
    title: "数学建模竞赛报名通知",
    body: "10月30日为报名截止日期，请各位同学及时提交竞赛报名材料。比赛将于11月10日举行。",
    published: "2026-11-02",
    news: false,
  },
  {
    name: "future event lead",
    title: "校企交流座谈会报名通知",
    body: "11月10日，学校将举办校企交流座谈会，欢迎同学报名参加。请于11月8日前提交报名材料。",
    published: "2026-11-02",
    news: false,
  },
  {
    name: "biography contains past date",
    title: "人工智能学术讲座报名通知",
    body: "欢迎报名参加11月10日的学术讲座。主讲人简介：2020年10月30日获得博士学位，曾主持多个科研项目。",
    published: "2026-11-02",
    news: false,
  },
  {
    name: "historical quotation followed by new call",
    title: "踏青活动新一期报名通知",
    body: "10月30日，我们举办了上一期踏青活动。本期活动将于11月10日开展，现面向全体学生招募，请报名参加。",
    published: "2026-11-02",
    news: false,
  },
  {
    name: "invalid date must not invent retrospective evidence",
    title: "校企交流座谈会报名",
    body: "2月30日为填写错误的日期，具体活动时间待定，欢迎报名。",
    published: "2026-03-02",
    news: false,
  },
];

const failures: string[] = [];
for (const fixture of cases) {
  const article: ClassifierText = {
    title: fixture.title, bodyText: fixture.body, summary: fixture.body,
    publishDate: fixture.published, section: "", publisher: "", location: null,
  };
  const result = classifyWithModel(article, model);
  if ((result.category === "新闻") !== fixture.news) {
    failures.push(`${fixture.name}: got ${result.category}, expected ${fixture.news ? "news" : "non-news"}; scores=${JSON.stringify(result.scores)}`);
  }
}
assert.deepEqual(failures, [], failures.join("\n"));
const withoutDateRules = structuredClone(model);
delete withoutDateRules.newsFeatureRules;
for (const fixture of [
  { body: "2027年10月30日，学校召开校企交流座谈会。", published: "2026-11-02" },
  { body: "2月30日，学校召开校企交流座谈会。", published: "2026-03-02" },
  { body: "10月30日，学校召开校企交流座谈会。", published: "" },
  { body: "12月10日，学校召开校企交流座谈会，欢迎师生参加。", published: "2026-11-02" },
]) {
  const article: ClassifierText = { title: "校企交流座谈会", summary: fixture.body, bodyText: fixture.body, publishDate: fixture.published, section: "", publisher: "", location: null };
  assert.deepEqual(classifyWithModel(article, model).scores, classifyWithModel(article, withoutDateRules).scores,
    `${fixture.body} (${fixture.published}): Missing, invalid or future dates must not provide retrospective date evidence`);
}
console.log(`News boundaries passed (${cases.length} classification and 4 neutral-date cases)`);
