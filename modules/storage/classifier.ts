import type { Article, CategoryDef, ClassifierTaxonomy, ClassifierLabelRecord, ClassifierModel, ClassifierImportResult, IndexEntry } from "../types";
import type { ClassificationResult } from "../classifier/naiveBayes";
import { serializeStorageWrite } from "./writeQueue";
import { getClassifierTaxonomy, resolveActiveCategoryId, resolveCategoryId } from "./taxonomy";

const CURRENT_MODEL_KEY = "meta:classifierModel";
const PREVIOUS_MODEL_KEY = "meta:classifierPreviousModel";
const FEEDBACK_KEY = "meta:classifierFeedback";
const FEEDBACK_REVISION_KEY = "meta:classifierFeedbackRevision";
const ARCHIVE_INDEX_KEY = "meta:classifierArchiveIndex";
const ARCHIVE_PREFIX = "classifier:articleArchive:";
const TAXONOMY_KEY = "meta:classifierTaxonomy";

function activeLabel(taxonomy: ClassifierTaxonomy, name: string, id?: string): CategoryDef {
  const category = id !== undefined
    ? taxonomy.categories.find(item => item.id === id)
    : taxonomy.categories.find(item => item.name === name)
      ?? taxonomy.categories.find(item => item.id === name)
      ?? taxonomy.categories.find(item => item.aliases?.includes(name));
  if (!category) throw new Error("分类已删除或不存在，请刷新分类列表后重试");
  return category;
}

export interface ClassifierExportArticle {
  articleId: string;
  article: ClassifierLabelRecord["article"];
  predictedCategory: string;
  predictedCategoryId?: string;
  matchedKeywords: string[];
  archivedAt: number;
}

function articleKey(id: string): `articles:${string}` {
  return `articles:${id}`;
}

function archiveKey(id: string): `${typeof ARCHIVE_PREFIX}${string}` {
  return `${ARCHIVE_PREFIX}${id}`;
}

export async function archiveArticlesUnsafe(articles: Article[]): Promise<void> {
  if (articles.length === 0) return;
  const stored = await chrome.storage.local.get(ARCHIVE_INDEX_KEY);
  const ids = new Set((stored[ARCHIVE_INDEX_KEY] as string[] | undefined) ?? []);
  const keys = articles.map((article) => archiveKey(article.id));
  const existing = await chrome.storage.local.get(keys);
  const writes: Record<string, unknown> = {};
  for (const article of articles) {
    const key = archiveKey(article.id);
    const prior = existing[key] as ClassifierExportArticle | undefined;
    writes[key] = {
      articleId: article.id,
      article: feedbackSnapshot(article),
      predictedCategory: article.manuallyClassified ? prior?.predictedCategory ?? article.category : article.category,
      predictedCategoryId: article.manuallyClassified ? prior?.predictedCategoryId ?? article.categoryId : article.categoryId,
      matchedKeywords: article.manuallyClassified ? prior?.matchedKeywords ?? article.matchedKeywords : article.matchedKeywords,
      archivedAt: prior?.archivedAt ?? Date.now(),
    } satisfies ClassifierExportArticle;
    ids.add(article.id);
  }
  writes[ARCHIVE_INDEX_KEY] = [...ids];
  await chrome.storage.local.set(writes);
}

export interface ClassifierStorageState {
  current: ClassifierModel | null;
  previous: ClassifierModel | null;
  feedback: ClassifierLabelRecord[];
  feedbackRevision: number;
}

export async function getClassifierState(): Promise<ClassifierStorageState> {
  const result = await chrome.storage.local.get([
    CURRENT_MODEL_KEY,
    PREVIOUS_MODEL_KEY,
    FEEDBACK_KEY,
    FEEDBACK_REVISION_KEY,
  ]);
  return {
    current: (result[CURRENT_MODEL_KEY] as ClassifierModel | undefined) ?? null,
    previous: (result[PREVIOUS_MODEL_KEY] as ClassifierModel | undefined) ?? null,
    feedback: (result[FEEDBACK_KEY] as ClassifierLabelRecord[] | undefined) ?? [],
    feedbackRevision: (result[FEEDBACK_REVISION_KEY] as number | undefined) ?? 0,
  };
}

export async function initializeClassifierModel(model: ClassifierModel): Promise<ClassifierModel> {
  return serializeStorageWrite(async () => {
    const result = await chrome.storage.local.get(CURRENT_MODEL_KEY);
    const current = result[CURRENT_MODEL_KEY] as ClassifierModel | undefined;
    if (current) return current;
    await chrome.storage.local.set({ [CURRENT_MODEL_KEY]: model });
    return model;
  });
}

export async function getLatestTrainingExamples(): Promise<ClassifierLabelRecord[]> {
  const { feedback } = await getClassifierState();
  const latestById = new Map<string, ClassifierLabelRecord>();
  for (const record of feedback) {
    const current = latestById.get(record.articleId);
    if (!current || record.correctedAt >= current.correctedAt) latestById.set(record.articleId, record);
  }
  return [...latestById.values()].sort((a, b) => a.correctedAt - b.correctedAt);
}

export async function getClassifierStatus() {
  const taxonomy = await getClassifierTaxonomy();
  const state = await getClassifierState();
  const latest = new Map<string, ClassifierLabelRecord>();
  for (const record of state.feedback) {
    const current = latest.get(record.articleId);
    if (!current || record.correctedAt >= current.correctedAt) latest.set(record.articleId, record);
  }
  const categoryLabelCounts: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const record of latest.values()) {
    const id = resolveActiveCategoryId(record.categoryId ?? resolveCategoryId(record.category, taxonomy), taxonomy);
    const name = taxonomy.categories.find(category => category.id === id)!.name;
    categoryLabelCounts[name] = (categoryLabelCounts[name] ?? 0) + 1;
  }
  const trainedIds = state.current?.trainedLabelRecordIds ? new Set(state.current.trainedLabelRecordIds) : null;
  const pendingIds = new Set(
    [...latest.values()]
      .filter((record) => trainedIds ? !trainedIds.has(record.id) : record.correctedAt > (state.current?.createdAt ?? 0))
      .map((record) => record.articleId),
  );
  return {
    modelVersion: state.current?.version ?? null,
    previousModelVersion: state.previous?.version ?? null,
    labeledArticleCount: latest.size,
    pendingLabelCount: pendingIds.size,
    categoryLabelCounts,
  };
}

export async function recordManualLabel(
  articleId: string,
  category: string,
  source: ClassifierLabelRecord["source"],
  force = false,
  categoryId?: string,
): Promise<boolean> {
  await getClassifierTaxonomy();
  return serializeStorageWrite(async () => {
    const key = articleKey(articleId);
    const stored = await chrome.storage.local.get([key, "meta:index", FEEDBACK_KEY, FEEDBACK_REVISION_KEY, TAXONOMY_KEY]);
    const article = stored[key] as Article | undefined;
    if (!article) return false;
    const target = activeLabel(stored[TAXONOMY_KEY] as ClassifierTaxonomy, category, categoryId);
    category = target.name;
    categoryId = target.id;
    const feedback = (stored[FEEDBACK_KEY] as ClassifierLabelRecord[] | undefined) ?? [];
    if (article.category === category && article.manuallyClassified && !force) return false;
    if (force && feedback.some((record) =>
      record.articleId === articleId && record.source === source && record.category === category,
    )) return false;

    const record: ClassifierLabelRecord = {
      id: crypto.randomUUID(),
      articleId,
      previousCategory: article.category,
      category,
      categoryId,
      previousCategoryId: article.categoryId,
      correctedAt: Date.now(),
      source,
      article: feedbackSnapshot(article),
    };
    const updated = { ...article, category, categoryId, matchedKeywords: [], manuallyClassified: true, needsReview: false };
    const entries = (stored["meta:index"] || []) as IndexEntry[];
    const entryIndex = entries.findIndex((entry) => entry.id === articleId);
    if (entryIndex >= 0) entries[entryIndex] = { ...entries[entryIndex], category };
    const revision = (stored[FEEDBACK_REVISION_KEY] as number | undefined) ?? 0;
    await chrome.storage.local.set({
      [key]: updated,
      "meta:index": entries,
      [FEEDBACK_KEY]: [...feedback, record],
      [FEEDBACK_REVISION_KEY]: revision + 1,
    });
    return true;
  });
}

export async function importClassifierLabelsCsv(csv: string): Promise<ClassifierImportResult> {
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new Error("CSV 未包含任何数据行");
  const headers = rows[0].map((value) => value.trim().toLocaleLowerCase());
  const idColumn = headers.indexOf("article_id") >= 0 ? headers.indexOf("article_id") : headers.indexOf("id");
  const labelColumn = headers.indexOf("confirmed_category");
  if (idColumn < 0 || labelColumn < 0) {
    throw new Error("CSV 需包含 article_id 和 confirmed_category 列；请只在 confirmed_category 中填写人工标签");
  }

  const taxonomy = await getClassifierTaxonomy();
  const validCategories = new Map<string, CategoryDef>();
  for (const category of taxonomy.categories) {
    for (const alias of category.aliases ?? []) validCategories.set(alias.toLocaleLowerCase(), category);
  }
  for (const category of taxonomy.categories) {
    validCategories.set(category.name.toLocaleLowerCase(), category);
  }
  for (const category of taxonomy.categories) {
    validCategories.set(category.id.toLocaleLowerCase(), category);
  }
  const uniqueLabels = new Map<string, CategoryDef>();
  const duplicateIds = new Set<string>();
  const invalidCategories = new Set<string>();
  let skippedBlank = 0;
  let invalidRows = 0;
  for (const row of rows.slice(1)) {
    const articleId = row[idColumn]?.trim() ?? "";
    const rawCategory = row[labelColumn]?.trim() ?? "";
    if (!rawCategory) {
      skippedBlank++;
      continue;
    }
    if (!articleId) {
      invalidRows++;
      continue;
    }
    const category = validCategories.get(rawCategory.toLocaleLowerCase());
    if (!category) {
      invalidRows++;
      invalidCategories.add(rawCategory);
      continue;
    }
    if (uniqueLabels.has(articleId)) duplicateIds.add(articleId);
    uniqueLabels.set(articleId, category);
  }

  const imported = await importManualLabels([...uniqueLabels].map(([articleId, category]) => ({ articleId, category: category.name, categoryId: category.id })), taxonomy.revision);
  return {
    imported: imported.imported,
    skippedBlank,
    duplicateIds: [...duplicateIds],
    invalidRows,
    invalidCategories: [...invalidCategories],
    unknownIds: imported.unknownIds,
  };
}

export async function importManualLabels(
  labels: Array<{ articleId: string; category: string; categoryId?: string }>,
  expectedTaxonomyRevision?: number,
): Promise<{ imported: number; unknownIds: string[] }> {
  await getClassifierTaxonomy();
  return serializeStorageWrite(async () => {
    const state = await chrome.storage.local.get([
      "meta:index", FEEDBACK_KEY, FEEDBACK_REVISION_KEY, ARCHIVE_INDEX_KEY, TAXONOMY_KEY,
    ]);
    const taxonomy = state[TAXONOMY_KEY] as ClassifierTaxonomy;
    if (expectedTaxonomyRevision !== undefined && taxonomy.revision !== expectedTaxonomyRevision) {
      throw new Error("导入期间分类设置发生变化，请重试");
    }
    const resolvedLabels = labels.map(label => {
      const target = activeLabel(taxonomy, label.category, label.categoryId);
      return { ...label, category: target.name, categoryId: target.id };
    });
    const entries = (state["meta:index"] || []) as IndexEntry[];
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    const ids = labels.map(({ articleId }) => articleId);
    const liveKeys = ids.map(articleKey);
    const archiveKeys = ids.map(archiveKey);
    const [liveResult, archiveResult] = await Promise.all([
      chrome.storage.local.get([...new Set(liveKeys)]),
      chrome.storage.local.get([...new Set(archiveKeys)]),
    ]);
    const feedback = (state[FEEDBACK_KEY] as ClassifierLabelRecord[] | undefined) ?? [];
    const latestById = new Map<string, ClassifierLabelRecord>();
    for (const record of feedback) {
      const latest = latestById.get(record.articleId);
      if (!latest || record.correctedAt >= latest.correctedAt) latestById.set(record.articleId, record);
    }
    let revision = (state[FEEDBACK_REVISION_KEY] as number | undefined) ?? 0;
    const writes: Record<string, unknown> = {};
    const unknownIds: string[] = [];
    let imported = 0;

    for (const label of resolvedLabels) {
      const articleKeyValue = articleKey(label.articleId);
      const archiveKeyValue = archiveKey(label.articleId);
      const liveArticle = liveResult[articleKeyValue] as Article | undefined;
      const archived = archiveResult[archiveKeyValue] as ClassifierExportArticle | undefined;
      const priorFeedback = latestById.get(label.articleId);
      const snapshot = liveArticle
        ? feedbackSnapshot(liveArticle)
        : archived?.article ?? priorFeedback?.article;
      if (!snapshot) {
        unknownIds.push(label.articleId);
        continue;
      }
      if (liveArticle && liveArticle.category === label.category && liveArticle.manuallyClassified) continue;
      if (!liveArticle && (priorFeedback?.categoryId === label.categoryId || (!priorFeedback?.categoryId && priorFeedback?.category === label.category))) continue;

      const previousCategory = liveArticle?.category ?? priorFeedback?.category ?? archived?.predictedCategory ?? "";
      const record: ClassifierLabelRecord = {
        id: crypto.randomUUID(),
        articleId: label.articleId,
        previousCategory,
        category: label.category,
        categoryId: label.categoryId,
        previousCategoryId: liveArticle?.categoryId ?? priorFeedback?.categoryId ?? archived?.predictedCategoryId,
        correctedAt: Date.now(),
        source: "csv-import",
        article: snapshot,
      };
      feedback.push(record);
      latestById.set(label.articleId, record);
      revision++;
      if (liveArticle && entryById.has(label.articleId)) {
        writes[articleKeyValue] = {
          ...liveArticle,
          category: label.category,
          categoryId: label.categoryId,
          matchedKeywords: [],
          manuallyClassified: true,
          needsReview: false,
        };
        entryById.set(label.articleId, { ...entryById.get(label.articleId)!, category: label.category });
      }
      imported++;
    }

    if (imported > 0) {
      writes["meta:index"] = [...entryById.values()];
      writes[FEEDBACK_KEY] = feedback;
      writes[FEEDBACK_REVISION_KEY] = revision;
      await chrome.storage.local.set(writes);
    }
    return { imported, unknownIds };
  });
}

export async function getExportData(): Promise<{
  articles: ClassifierExportArticle[];
  state: ClassifierStorageState;
  taxonomy: ClassifierTaxonomy;
}> {
  await getClassifierTaxonomy();
  return serializeStorageWrite(async () => {
    const [indexResult, state] = await Promise.all([
      chrome.storage.local.get(["meta:index", ARCHIVE_INDEX_KEY, TAXONOMY_KEY]),
      getClassifierState(),
    ]);
    const entries = (indexResult["meta:index"] || []) as IndexEntry[];
    const liveKeys = entries.map((entry) => articleKey(entry.id));
    const liveResult = liveKeys.length > 0 ? await chrome.storage.local.get(liveKeys) : {};
    const liveArticles = liveKeys.map((key) => liveResult[key]).filter(Boolean) as Article[];
    await archiveArticlesUnsafe(liveArticles);

    const archiveIds = new Set((indexResult[ARCHIVE_INDEX_KEY] as string[] | undefined) ?? []);
    for (const article of liveArticles) archiveIds.add(article.id);
    const archiveKeys = [...archiveIds].map(archiveKey);
    const archiveResult = archiveKeys.length > 0 ? await chrome.storage.local.get(archiveKeys) : {};
    const articles = archiveKeys
      .map((key) => archiveResult[key] as ClassifierExportArticle | undefined)
      .filter((item): item is ClassifierExportArticle => Boolean(item));
    return { articles, state, taxonomy: indexResult[TAXONOMY_KEY] as ClassifierTaxonomy };
  });
}

export async function commitTrainedModel(
  model: ClassifierModel,
  expectedFeedbackRevision: number,
  expectedCurrentVersion: number,
  results: Array<{ articleId: string; result: ClassificationResult }>,
  expectedTaxonomyRevision?: number,
): Promise<number> {
  return serializeStorageWrite(async () => {
    const state = await chrome.storage.local.get([
      CURRENT_MODEL_KEY,
      FEEDBACK_REVISION_KEY,
      FEEDBACK_KEY,
      "meta:classifierTaxonomy",
      "meta:index",
    ]);
    const revision = (state[FEEDBACK_REVISION_KEY] as number | undefined) ?? 0;
    const taxonomyRevision = ((state["meta:classifierTaxonomy"] as { revision?: number } | undefined)?.revision) ?? 0;
    if (expectedTaxonomyRevision !== undefined && taxonomyRevision !== expectedTaxonomyRevision) {
      throw new Error("训练期间分类设置发生变化，请刷新后重新训练");
    }
    if (revision !== expectedFeedbackRevision) {
      throw new Error("训练期间人工标签有变化，请重新训练以包含最新标签");
    }
    const oldModel = state[CURRENT_MODEL_KEY] as ClassifierModel | undefined;
    if (!oldModel || oldModel.version !== expectedCurrentVersion) {
      throw new Error("训练期间模型版本已变化，请刷新后重试");
    }
    const entries = (state["meta:index"] || []) as IndexEntry[];
    const keys = entries.map((entry) => articleKey(entry.id));
    const articleResult = keys.length > 0 ? await chrome.storage.local.get(keys) : {};
    const resultById = new Map(results.map((entry) => [entry.articleId, entry.result]));
    const writes: Record<string, unknown> = {};
    let changed = 0;
    const nextEntries = entries.map((entry) => {
      const article = articleResult[articleKey(entry.id)] as Article | undefined;
      const result = resultById.get(entry.id);
      if (!article || !result || article.manuallyClassified) return entry;
      const updated: Article = {
        ...article,
        category: result.category,
        categoryId: result.categoryId,
        matchedKeywords: result.matchedKeywords,
        classificationConfidence: result.confidence,
        needsReview: result.needsReview,
      };
      writes[articleKey(entry.id)] = updated;
      changed++;
      return { ...entry, category: updated.category };
    });
    writes["meta:index"] = nextEntries;
    const latestLabels = new Map<string, ClassifierLabelRecord>();
    for (const record of (state[FEEDBACK_KEY] as ClassifierLabelRecord[] | undefined) ?? []) {
      const prior = latestLabels.get(record.articleId);
      if (!prior || record.correctedAt >= prior.correctedAt) latestLabels.set(record.articleId, record);
    }
    writes[CURRENT_MODEL_KEY] = { ...model, trainedLabelRecordIds: [...latestLabels.values()].map(record => record.id) };
    if (oldModel) writes[PREVIOUS_MODEL_KEY] = oldModel;
    await chrome.storage.local.set(writes);
    return changed;
  });
}

export async function commitRollback(
  expectedCurrentVersion: number,
  expectedPreviousVersion: number,
  results: Array<{ articleId: string; result: ClassificationResult }>,
  expectedTaxonomyRevision?: number,
): Promise<{ model: ClassifierModel; changed: number }> {
  return serializeStorageWrite(async () => {
    const state = await chrome.storage.local.get([CURRENT_MODEL_KEY, PREVIOUS_MODEL_KEY, "meta:classifierTaxonomy", "meta:index"]);
    const current = state[CURRENT_MODEL_KEY] as ClassifierModel | undefined;
    const previous = state[PREVIOUS_MODEL_KEY] as ClassifierModel | undefined;
    const taxonomyRevision = ((state["meta:classifierTaxonomy"] as { revision?: number } | undefined)?.revision) ?? 0;
    if (expectedTaxonomyRevision !== undefined && taxonomyRevision !== expectedTaxonomyRevision) {
      throw new Error("回退期间分类设置发生变化，请刷新后重试");
    }
    if (!current || !previous || current.version !== expectedCurrentVersion || previous.version !== expectedPreviousVersion) {
      throw new Error("模型版本已变化，请刷新后重试回退");
    }
    const entries = (state["meta:index"] || []) as IndexEntry[];
    const keys = entries.map((entry) => articleKey(entry.id));
    const articleResult = keys.length > 0 ? await chrome.storage.local.get(keys) : {};
    const resultById = new Map(results.map((entry) => [entry.articleId, entry.result]));
    const writes: Record<string, unknown> = {};
    let changed = 0;
    const nextEntries = entries.map((entry) => {
      const article = articleResult[articleKey(entry.id)] as Article | undefined;
      const result = resultById.get(entry.id);
      if (!article || !result || article.manuallyClassified) return entry;
      const updated: Article = {
        ...article,
        category: result.category,
        categoryId: result.categoryId,
        matchedKeywords: result.matchedKeywords,
        classificationConfidence: result.confidence,
        needsReview: result.needsReview,
      };
      writes[articleKey(entry.id)] = updated;
      changed++;
      return { ...entry, category: updated.category };
    });
    writes["meta:index"] = nextEntries;
    writes[CURRENT_MODEL_KEY] = previous;
    writes[PREVIOUS_MODEL_KEY] = current;
    await chrome.storage.local.set(writes);
    return { model: previous, changed };
  });
}

function feedbackSnapshot(article: Article): ClassifierLabelRecord["article"] {
  return {
    url: article.url,
    title: article.title,
    summary: article.summary,
    bodyText: article.bodyText,
    section: article.section,
    publisher: article.publisher,
    location: article.location,
    eventTime: article.eventTime,
    eventDate: article.eventDate,
    updatedAt: article.updatedAt,
    topic: article.topic,
    titleAttributes: article.titleAttributes,
    publishDate: article.publishDate,
  };
}

function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("CSV 包含未匹配的引号");
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}
