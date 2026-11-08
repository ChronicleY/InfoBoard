import assert from "node:assert/strict";
import { classifyWithModel, trainClassifier } from "../modules/classifier/naiveBayes";
import type { Article, CategoryDef, ClassifierLabelRecord, ClassifierModel, IndexEntry } from "../modules/types";
import { getClassifierTaxonomy, resolveActiveCategoryId, resolveCategoryId, saveClassifierCategories } from "../modules/storage/taxonomy";
import { commitRollback, commitTrainedModel, getClassifierState, getClassifierStatus, getExportData, importClassifierLabelsCsv, recordManualLabel } from "../modules/storage/classifier";

const database: Record<string, unknown> = Object.create(null);
let failNextWrite = false;
Object.assign(globalThis, {
  chrome: { storage: { local: {
    async get(keys: string | string[] | null) {
      const names = keys === null ? Object.keys(database) : typeof keys === "string" ? [keys] : keys;
      return structuredClone(Object.fromEntries(names.filter(key => Object.hasOwn(database, key)).map(key => [key, database[key]])));
    },
    async set(values: Record<string, unknown>) {
      if (failNextWrite) { failNextWrite = false; throw new Error("Synthetic storage failure"); }
      Object.assign(database, structuredClone(values));
    },
  } } },
});

function statistics(model: ClassifierModel) {
  const { categories, ...rest } = model;
  return { ...rest, categoryIds: categories.map(category => category.id).sort() };
}

async function main() {
  const previous = structuredClone(trainClassifier([], 4));
  const current = structuredClone(trainClassifier([], 5));
  for (const model of [previous, current]) {
    for (const category of model.categories) {
      if (category.id === "research") category.name = "科研项目";
      if (category.id === "volunteer") category.name = "志愿活动";
    }
  }
  const article: Article = {
    id: "synthetic-migration", title: "合成科研通知", bodyText: "合成正文", summary: "合成摘要",
    url: "https://example.invalid/synthetic-migration", section: "", publisher: "合成单位",
    publishDate: "2026-11-01", location: null, category: "科研项目", matchedKeywords: [],
    manuallyClassified: true, competitionMatch: null, favorite: true, crawledAt: 1,
  };
  const feedback: ClassifierLabelRecord = {
    id: "synthetic-label", articleId: article.id, previousCategory: "其他", category: "科研项目",
    correctedAt: 1, source: "popup", article,
  };
  database["meta:classifierModel"] = structuredClone(current);
  database["meta:classifierPreviousModel"] = structuredClone(previous);
  database["meta:classifierFeedback"] = [feedback];
  database["meta:classifierFeedbackRevision"] = 7;
  database[`articles:${article.id}`] = article;
  database["meta:index"] = [{ id: article.id, category: article.category, publishDate: article.publishDate, section: "", favorite: true }];

  // A failed migration cannot leave a new taxonomy alongside old article state.
  failNextWrite = true;
  await assert.rejects(getClassifierTaxonomy());
  assert.equal(database["meta:classifierTaxonomy"], undefined);
  assert.deepEqual(database["meta:classifierModel"], current);

  const taxonomy = await getClassifierTaxonomy();
  assert.equal(taxonomy.categories.find(category => category.id === "research")?.name, "科研教师");
  assert.equal(taxonomy.categories.find(category => category.id === "volunteer")?.name, "志愿与活动");
  assert.equal((database[`articles:${article.id}`] as Article).categoryId, "research");
  assert.equal((database[`articles:${article.id}`] as Article).category, "科研教师");
  assert.equal((database[`articles:${article.id}`] as Article).favorite, true);
  assert.equal((database["meta:index"] as IndexEntry[])[0].category, "科研教师");
  assert.equal((database["meta:classifierFeedback"] as ClassifierLabelRecord[])[0].category, "科研项目", "Historical display text should remain intact");
  assert.equal((database["meta:classifierFeedback"] as ClassifierLabelRecord[])[0].categoryId, "research");
  assert.equal(database["meta:classifierFeedbackRevision"], 7);
  assert.deepEqual(statistics(database["meta:classifierModel"] as ClassifierModel), statistics(current));
  assert.deepEqual(statistics(database["meta:classifierPreviousModel"] as ClassifierModel), statistics(previous));
  assert.deepEqual(await getClassifierTaxonomy(), taxonomy, "Migration must be idempotent");

  const renamed = await saveClassifierCategories(taxonomy.categories.map(category => category.id === "research" ? { ...category, name: "教师通知" } : category), taxonomy.revision);
  assert.equal((database[`articles:${article.id}`] as Article).category, "教师通知");
  await assert.rejects(saveClassifierCategories(taxonomy.categories, taxonomy.revision), "Stale category editor must not overwrite newer changes");
  const savedBeforeFailure = structuredClone(database);
  failNextWrite = true;
  await assert.rejects(saveClassifierCategories([...renamed.categories].reverse(), renamed.revision));
  assert.deepEqual({ ...database }, savedBeforeFailure);

  const replacement: CategoryDef = { id: "custom-synthetic", name: "科研项目", keywords: [], isBuiltin: false, sortOrder: 99 };
  const withAliasCollision = await saveClassifierCategories([...renamed.categories, replacement], renamed.revision);
  assert.equal(resolveCategoryId("科研项目", withAliasCollision), replacement.id, "Current exact name must take precedence over a legacy alias");
  const deleted = await saveClassifierCategories(withAliasCollision.categories.filter(category => category.id !== "research"), withAliasCollision.revision);
  assert.equal((database[`articles:${article.id}`] as Article).categoryId, "other");
  assert.equal((database[`articles:${article.id}`] as Article).manuallyClassified, true);
  assert.equal(resolveActiveCategoryId("research", deleted), "other");
  assert.equal((database["meta:classifierFeedback"] as ClassifierLabelRecord[])[0].categoryId, "research");
  await assert.rejects(saveClassifierCategories([...deleted.categories, { ...replacement, id: "research", name: "重新加入" }], deleted.revision));
  await assert.rejects(saveClassifierCategories(deleted.categories.filter(category => category.id !== "other"), deleted.revision));
  await assert.rejects(saveClassifierCategories([...deleted.categories, { ...replacement, id: "another", name: deleted.categories[0].name }], deleted.revision));

  const retrained = trainClassifier([], 6, deleted.categories, deleted.retiredCategoryIds);
  assert.equal(retrained.classDocumentCounts.other, 1, "Deleted category seeds must not contaminate the other class");
  assert.equal(retrained.categories.some(category => category.id === "research"), false);
  const customCategories = deleted.categories.map(category => category.id === replacement.id
    ? { ...category, keywords: ["攀岩训练", "攀岩", "抱石"] } : category);
  const customModel = trainClassifier([
    { articleId: "synthetic-sport", categoryId: replacement.id, category: replacement.name, article: { ...article, title: "攀岩抱石训练报名", summary: "攀岩训练" } },
  ], 7, customCategories, deleted.retiredCategoryIds);
  assert.equal(customModel.categoryLabelCounts[replacement.id], 1);
  assert.equal(classifyWithModel({ ...article, title: "攀岩抱石训练报名", summary: "攀岩训练" }, customModel).categoryId, replacement.id);
  const renamedCategories = customCategories.map(category => category.id === replacement.id ? { ...category, name: "运动训练" } : category);
  const renamedModel = trainClassifier([
    { articleId: "synthetic-sport", categoryId: replacement.id, category: replacement.name, article: { ...article, title: "攀岩抱石训练报名" } },
  ], 8, renamedCategories, deleted.retiredCategoryIds);
  assert.equal(renamedModel.categoryLabelCounts[replacement.id], 1, "Stable ID must preserve labels after another rename");
  await assert.rejects(recordManualLabel(article.id, "科研项目", "popup", false, "research"), "Deleted IDs must be rejected even when an active class reuses the display name");
  await recordManualLabel(article.id, "科研项目", "popup", false, replacement.id);
  assert.equal((database[`articles:${article.id}`] as Article).categoryId, replacement.id);
  const status = await getClassifierStatus();
  assert.equal(status.categoryLabelCounts[replacement.name], 1);
  const imported = await importClassifierLabelsCsv(`article_id,confirmed_category\n${article.id},讲座会议`);
  assert.equal(imported.imported, 1);
  assert.equal((database[`articles:${article.id}`] as Article).categoryId, "lecture", "CSV corrections must not retain the previous article category ID");
  const exported = await getExportData();
  assert.deepEqual(exported.taxonomy, deleted);
  const beforeTraining = await getClassifierState();
  await assert.rejects(commitTrainedModel(renamedModel, beforeTraining.feedbackRevision, 5, [], deleted.revision - 1));
  await assert.rejects(commitRollback(5, 4, [], deleted.revision - 1));
  assert.equal((await getClassifierState()).current?.version, 5);
  await commitTrainedModel(renamedModel, beforeTraining.feedbackRevision, 5, [], deleted.revision);
  assert.equal((await getClassifierStatus()).pendingLabelCount, 0);
  await recordManualLabel(article.id, "科研项目", "popup", false, replacement.id);
  assert.equal((await getClassifierStatus()).pendingLabelCount, 1, "Changed latest labels must remain pending regardless of timestamp granularity");
  console.log("Taxonomy independent migration review passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
