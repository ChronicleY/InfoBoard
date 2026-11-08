import assert from "node:assert/strict";
import type { Article } from "../modules/types";
import { classifyWithModel, trainClassifier } from "../modules/classifier/naiveBayes";
import {
  commitRollback,
  commitTrainedModel,
  getClassifierState,
  getExportData,
  getLatestTrainingExamples,
  importClassifierLabelsCsv,
  initializeClassifierModel,
  recordManualLabel,
} from "../modules/storage/classifier";
import { deleteArticles, getArticle, saveArticles, updateArticle } from "../modules/storage/notices";

const database: Record<string, unknown> = Object.create(null);
let writes = 0;
let failNextWrite = false;
Object.assign(globalThis, {
  chrome: {
    storage: {
      local: {
        async get(keys: string | string[] | null) {
          const names = keys === null ? Object.keys(database) : typeof keys === "string" ? [keys] : keys;
          return structuredClone(Object.fromEntries(names.filter(key => Object.hasOwn(database, key)).map(key => [key, database[key]])));
        },
        async set(values: Record<string, unknown>) {
          if (failNextWrite) {
            failNextWrite = false;
            throw new Error("Simulated storage quota failure");
          }
          writes++;
          Object.assign(database, structuredClone(values));
        },
        async remove(keys: string | string[]) {
          for (const key of typeof keys === "string" ? [keys] : keys) delete database[key];
        },
      },
    },
  },
});

function article(id: string): Article {
  return {
    id,
    title: "Synthetic review fixture",
    summary: "Synthetic text for storage tests only",
    bodyText: "Synthetic complete text",
    url: `https://www1.szu.edu.cn/board/view.asp?id=${id}`,
    section: "",
    publisher: "",
    publishDate: "2026-01-01",
    location: null,
    category: "其他",
    matchedKeywords: [],
    competitionMatch: null,
    favorite: false,
    crawledAt: 1,
  };
}

async function main() {
  const initial = structuredClone(trainClassifier([], 1));
  await initializeClassifierModel(initial);
  await saveArticles([article("review-1"), article("review-2"), article("review-3")]);
  const longBody = "完整正文".repeat(1200);
  await updateArticle("review-2", { bodyText: longBody });
  const exported = await getExportData();
  assert.equal(exported.articles.find(item => item.articleId === "review-2")?.article.bodyText, longBody,
    "Export archives must retain complete stored body text");

  await Promise.all([
    recordManualLabel("review-1", "志愿与活动", "popup"),
    updateArticle("review-1", { favorite: true }),
  ]);
  assert.equal((await getArticle("review-1"))?.category, "志愿与活动");
  assert.equal((await getArticle("review-1"))?.favorite, true);
  assert.deepEqual((await getClassifierState()).current, initial, "Manual correction must not train");
  const revisionBeforeDuplicate = (await getClassifierState()).feedbackRevision;
  assert.equal(await recordManualLabel("review-1", "志愿与活动", "popup"), false);
  assert.equal((await getClassifierState()).feedbackRevision, revisionBeforeDuplicate,
    "Repeating an identical manual label must not create new feedback");
  await recordManualLabel("review-1", "校园生活", "popup");
  assert.equal((await getClassifierState()).feedback.length, 2);
  const latest = await getLatestTrainingExamples();
  assert.equal(latest.length, 1, "Repeated edits must not duplicate training samples");
  assert.equal(latest[0].category, "校园生活");

  await getExportData();
  await deleteArticles(["review-2"]);
  const imported = await importClassifierLabelsCsv("article_id,confirmed_category\r\nreview-2,招聘实习\r\nreview-3,\r\nunknown,其他");
  assert.equal(imported.imported, 1, "Expired exported articles must remain labelable");
  assert.equal(imported.skippedBlank, 1);
  assert.deepEqual(imported.unknownIds, ["unknown"]);
  assert.equal(await getArticle("review-2"), null, "Import must not resurrect expired notices");
  assert.equal((await getLatestTrainingExamples()).length, 2);
  assert.deepEqual((await getClassifierState()).current, initial);

  const state = await getClassifierState();
  const candidate = trainClassifier([], 2);
  const result = classifyWithModel(article("review-3"), candidate);
  await assert.rejects(commitTrainedModel(candidate, state.feedbackRevision - 1, initial.version, []));
  await assert.rejects(commitTrainedModel(candidate, state.feedbackRevision, initial.version + 10, []));
  assert.deepEqual((await getClassifierState()).current, initial);
  failNextWrite = true;
  await assert.rejects(commitTrainedModel(candidate, state.feedbackRevision, initial.version, [{ articleId: "review-3", result }]));
  assert.deepEqual((await getClassifierState()).current, initial, "Failed commit must preserve old model");

  const beforeCommit = writes;
  await commitTrainedModel(candidate, state.feedbackRevision, initial.version, [{ articleId: "review-3", result }]);
  assert.equal(writes - beforeCommit, 1, "Model commit must use one atomic storage write");
  assert.deepEqual((await getClassifierState()).previous, initial);
  assert.equal((await getArticle("review-1"))?.category, "校园生活");
  assert.equal((await getArticle("review-1"))?.favorite, true);

  const beforeRollback = writes;
  await commitRollback(candidate.version, initial.version, [{ articleId: "review-3", result: classifyWithModel(article("review-3"), initial) }]);
  assert.equal(writes - beforeRollback, 1, "Rollback must use one atomic storage write");
  assert.deepEqual((await getClassifierState()).current, initial, "Rollback must restore complete pipeline");
  assert.equal((await getArticle("review-1"))?.category, "校园生活");
  console.log("Classifier storage review passed");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
