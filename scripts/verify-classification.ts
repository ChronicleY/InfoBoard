import assert from "node:assert/strict";
import type { Article } from "../modules/types";
import { classifyWithModel, trainClassifier } from "../modules/classifier/naiveBayes";

const model = trainClassifier([], 1);

function article(title: string, overrides: Partial<Article> = {}): Article {
  return {
    id: "classification-fixture",
    title,
    url: "https://example.invalid/notice",
    section: "",
    publisher: "",
    publishDate: "",
    location: null,
    summary: "",
    bodyText: "",
    category: "其他",
    matchedKeywords: [],
    competitionMatch: null,
    favorite: false,
    crawledAt: 0,
    ...overrides,
  };
}

function expectCategory(title: string, expected: string, overrides: Partial<Article> = {}) {
  const result = classifyWithModel(article(title, overrides), model);
  assert.equal(result.category, expected, `${title}: expected ${expected}, got ${result.category}; keywords=${JSON.stringify(result.matchedKeywords)}; scores=${JSON.stringify(result.scores)}`);
  return result;
}

expectCategory(
  "高等研究院知名学者讲学计划第213期：DNA纳米机器的可控组装与智能药物递送",
  "讲座会议",
  { section: "学术讲座", publisher: "高等研究院" },
);

const lectureTitle = "高等研究院知名学者讲学计划第213期：DNA纳米机器的可控组装与智能药物递送";
const realLectureFields: Partial<Article> = {
  section: "教务教学",
  topic: lectureTitle,
  summary: "报告主题：DNA纳米机器的可控组装与智能药物递送。嘉宾简介：丁宝全教授曾进行博士后研究，获得优秀青年基金，并主持国家重点研发计划。报告摘要介绍DNA自组装结构、纳米机器和智能药物递送。",
  bodyText: "主讲人：丁宝全教授。主持人：李晓光研究员。嘉宾简介：曾获博士学位并在国家实验室开展博士后研究，获得基金资助，主持重点研发计划。报告摘要：DNA为基础的自组装方法可制备复杂结构，并用于药物载体及肿瘤治疗。",
};
expectCategory(lectureTitle, "讲座会议", realLectureFields);
expectCategory(lectureTitle, "讲座会议", { ...realLectureFields, section: "学术讲座" });

expectCategory(
  "关于举办本科生、硕士研究生和博士研究生共同参加的校园摄影大赛的通知",
  "比赛竞赛",
  { summary: "面向本科生和研究生开放报名，欢迎全校学生参加。", section: "校园文化" },
);

expectCategory("关于举办校园文化节的通知", "校园生活", { section: "校园生活" });

expectCategory(
  "管理学院研究生在第十二届全国大学生统计建模大赛中斩获佳绩",
  "新闻",
  { summary: "近日，管理学院研究生团队在全国大学生统计建模竞赛中获奖。" },
);

const graduateCourse = expectCategory("2026年研究生课程考试安排通知", "研究生相关", { section: "研究生院" });
assert.equal(graduateCourse.matchedKeywords.includes("__graduate_exclusive__"), false, "Internal audience feature must not be presented as a keyword");
expectCategory("关于博士研究生学位论文答辩安排的通知", "研究生相关", { section: "研究生院" });
expectCategory("关于开展校园学术活动报名的通知", "研究生相关", {
  bodyText: "参加对象：仅限硕士研究生参加。",
});
const mixedBodyAudience = classifyWithModel(article("学生摄影作品征集活动通知", {
  bodyText: "本活动面向研究生和本科生开放，欢迎报名参加。",
}), model);
assert.notEqual(mixedBodyAudience.category, "研究生相关", "A mixed audience stated in the body must not become graduate-exclusive");
expectCategory("国家自然科学基金项目申报通知", "科研教师", { section: "科研处" });
expectCategory("关于开展2026年大学英语四六级考试报名的通知", "教务教学", { section: "教务部" });
expectCategory("关于评选2026年优秀学生奖学金的通知", "奖学金/评奖评优", { section: "学生工作部" });

const nonRetrospectiveLecture = classifyWithModel(article(
  "关于举办人工智能学术报告会的通知",
  { summary: "报告会将于下周举行，欢迎师生报名参加。" },
), model);
assert.equal(nonRetrospectiveLecture.category, "讲座会议");

console.log("Classification verification passed");
