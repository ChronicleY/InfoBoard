import assert from "node:assert/strict";
import { BUILTIN_CATEGORIES } from "../modules/types";
import { matchByKeywords, matchNewsKeywords } from "../modules/classifier/keywordMatcher";
import { matchCompetition } from "../modules/classifier/competitionMatcher";

function category(title: string, summary: string, _section: string): string {
  return matchByKeywords(title, summary, BUILTIN_CATEGORIES)?.category.name ?? "待分类";
}

// These are representative board titles covering the known overlap points.
assert.equal(category("研究生招生考试报名通知", "", "教务教学"), "教务");
assert.equal(category("本科生论文答辩安排通知", "", "教务教学"), "教务");
assert.equal(category("关于举办校园文化节的通知", "", "校园生活"), "活动");
assert.equal(category("国家自然科学基金项目申报通知", "", "科研动态"), "科研");
assert.equal(category("关于2026年优秀学生名单公示", "", "学生工作"), "公示");

// A retrospective phrase in the body alone must not trigger the title-only news rule.
assert.equal(matchNewsKeywords("关于举办学术报告的通知", "报告内容将于下周发布", "2026-09-23"), null);
assert.deepEqual(
  matchNewsKeywords("我校成功举办创新创业活动", "", "2026-09-23"),
  ["成功举办"],
);
assert.equal(
  matchCompetition("关于开展挑战杯校内选拔赛的通知", ""),
  "“挑战杯”全国大学生课外学术科技作品竞赛",
);

console.log("classification verification passed");
