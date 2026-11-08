import { BUILTIN_CATEGORIES, type Article, type CategoryDef, type ClassifierTaxonomy, type ClassifierLabelRecord, type ClassifierModel, type IndexEntry } from "../types";
import { serializeStorageWrite } from "./writeQueue";

const TAXONOMY_KEY = "meta:classifierTaxonomy";
const CURRENT_MODEL_KEY = "meta:classifierModel";
const PREVIOUS_MODEL_KEY = "meta:classifierPreviousModel";
const FEEDBACK_KEY = "meta:classifierFeedback";

export function makeDefaultTaxonomy(): ClassifierTaxonomy {
  const categories = BUILTIN_CATEGORIES.map((category) => {
    if (category.id === "research") return {
      ...category,
      name: "科研教师",
      aliases: [...(category.aliases ?? []), "科研项目"],
      keywords: [...category.keywords, "科研公告", "科研教师", "教师项目", "教师科研", "项目指南", "成果申报"],
    };
    if (category.id === "volunteer") return {
      ...category,
      name: "志愿与活动",
      aliases: [...(category.aliases ?? []), "志愿活动"],
      keywords: [...category.keywords, "心理团体招募", "踏青", "节日活动", "活动招募", "APEC", "亚太经合组织", "会务志愿"],
    };
    if (category.id === "graduate") return {
      ...category,
      keywords: [...category.keywords, "博士生课程", "博士生考试", "博士研究生", "博士生招生", "博士生培养", "博士学位"],
    };
    return { ...category, aliases: [...(category.aliases ?? [])] };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
  return { schemaVersion: 1, revision: 1, categories, retiredCategoryIds: {} };
}

export async function getClassifierTaxonomy(): Promise<ClassifierTaxonomy> {
  return serializeStorageWrite(async () => {
    const stored = await chrome.storage.local.get([
      TAXONOMY_KEY, CURRENT_MODEL_KEY, PREVIOUS_MODEL_KEY, FEEDBACK_KEY, "meta:index",
    ]);
    const existing = stored[TAXONOMY_KEY] as ClassifierTaxonomy | undefined;
    if (existing?.categories?.length) return normalizeTaxonomy(existing);

    const taxonomy = makeDefaultTaxonomy();
    const models = [stored[CURRENT_MODEL_KEY], stored[PREVIOUS_MODEL_KEY]]
      .filter(Boolean) as ClassifierModel[];
    const idByName = new Map<string, string>();
    for (const category of taxonomy.categories) {
      idByName.set(category.name, category.id);
      for (const alias of category.aliases ?? []) idByName.set(alias, category.id);
    }
    for (const [name, id] of Object.entries({
      "\u8bb2\u5ea7": "lecture",
      "\u6bd4\u8d5b": "competition",
      "\u6559\u52a1": "academic",
      "\u79d1\u7814": "research",
      "\u65b0\u95fb": "news",
      "\u751f\u6d3b": "campus-life",
    })) {
      if (!idByName.has(name)) idByName.set(name, id);
    }
    for (const model of models) {
      for (const category of model.categories ?? []) {
        if (taxonomy.categories.some((item) => item.id === category.id)) idByName.set(category.name, category.id);
      }
    }

    const feedback = (stored[FEEDBACK_KEY] as ClassifierLabelRecord[] | undefined) ?? [];
    const migratedFeedback = feedback.map((record) => ({
      ...record,
      categoryId: record.categoryId ?? idByName.get(record.category) ?? "other",
      previousCategoryId: record.previousCategoryId ?? idByName.get(record.previousCategory) ?? undefined,
    }));
    const entries = (stored["meta:index"] as IndexEntry[] | undefined) ?? [];
    const keys = entries.map((entry) => `articles:${entry.id}`);
    const articles = keys.length ? await chrome.storage.local.get(keys) : {};
    const writes: Record<string, unknown> = { [TAXONOMY_KEY]: taxonomy };
    const migratedEntries: IndexEntry[] = [];
    for (const key of keys) {
      const article = articles[key] as Article | undefined;
      if (!article) {
        const entry = entries.find((item) => `articles:${item.id}` === key);
        if (entry) migratedEntries.push(entry);
        continue;
      }
      const id = article.categoryId ?? idByName.get(article.category) ?? "other";
      const category = taxonomy.categories.find((item) => item.id === id) ?? taxonomy.categories.find((item) => item.id === "other")!;
      writes[key] = { ...article, categoryId: category.id, category: category.name };
      migratedEntries.push({ ...entries.find((item) => item.id === article.id)!, category: category.name });
    }
    writes["meta:index"] = migratedEntries;
    if (feedback.length) writes[FEEDBACK_KEY] = migratedFeedback;
    for (const key of [CURRENT_MODEL_KEY, PREVIOUS_MODEL_KEY]) {
      const model = stored[key] as ClassifierModel | undefined;
      if (!model) continue;
      writes[key] = {
        ...model,
        categories: model.categories.map((category) => ({
          ...category,
          name: taxonomy.categories.find((item) => item.id === category.id)?.name ?? category.name,
          sortOrder: taxonomy.categories.find((item) => item.id === category.id)?.sortOrder ?? category.sortOrder,
        })),
      };
    }
    await chrome.storage.local.set(writes);
    return taxonomy;
  });
}

export async function saveClassifierCategories(categories: CategoryDef[], expectedRevision?: number): Promise<ClassifierTaxonomy> {
  await getClassifierTaxonomy();
  return serializeStorageWrite(async () => {
    const stored = await chrome.storage.local.get([TAXONOMY_KEY, "meta:index"]);
    const old = normalizeTaxonomy((stored[TAXONOMY_KEY] as ClassifierTaxonomy | undefined) ?? makeDefaultTaxonomy());
    if (expectedRevision !== undefined && expectedRevision !== old.revision) {
      throw new Error("分類設置已在其他窗口更新，請刷新後再保存");
    }
    const nextCategories = categories.map((category, sortOrder) => {
      const prior = old.categories.find((item) => item.id === category.id);
      const aliases = new Set(category.aliases ?? prior?.aliases ?? []);
      if (prior && prior.name !== category.name.trim()) aliases.add(prior.name);
      return { ...category, name: category.name.trim(), aliases: [...aliases], sortOrder };
    });
    validateCategories(nextCategories, old);
    const retiredCategoryIds = { ...old.retiredCategoryIds };
    const activeIds = new Set(nextCategories.map((category) => category.id));
    for (const category of old.categories) {
      if (!activeIds.has(category.id) && category.id !== "other") retiredCategoryIds[category.id] = "other";
    }
    const taxonomy: ClassifierTaxonomy = {
      schemaVersion: 1,
      revision: old.revision + 1,
      categories: nextCategories,
      retiredCategoryIds,
    };
    const entries = (stored["meta:index"] as IndexEntry[] | undefined) ?? [];
    const keys = entries.map((entry) => `articles:${entry.id}`);
    const articleResult = keys.length ? await chrome.storage.local.get(keys) : {};
    const other = nextCategories.find((category) => category.id === "other")!;
    const nextById = new Map(nextCategories.map((category) => [category.id, category]));
    const writes: Record<string, unknown> = { [TAXONOMY_KEY]: taxonomy };
    const nextEntries = entries.map((entry) => {
      const key = `articles:${entry.id}`;
      const article = articleResult[key] as Article | undefined;
      if (!article) return entry;
      const requestedId = article.categoryId ?? old.categories.find((category) => category.name === article.category)?.id ?? "other";
      const target = nextById.get(requestedId) ?? other;
      if (article.categoryId !== target.id || article.category !== target.name) {
        writes[key] = { ...article, categoryId: target.id, category: target.name };
      }
      return { ...entry, category: target.name };
    });
    writes["meta:index"] = nextEntries;
    await chrome.storage.local.set(writes);
    return taxonomy;
  });
}

export function resolveCategoryId(raw: string, taxonomy: ClassifierTaxonomy): string {
  const category = taxonomy.categories.find((item) => item.id === raw)
    ?? taxonomy.categories.find((item) => item.name === raw)
    ?? taxonomy.categories.find((item) => item.aliases?.includes(raw));
  if (category) return category.id;
  return taxonomy.retiredCategoryIds[raw] ?? "other";
}

export function resolveActiveCategoryId(rawId: string, taxonomy: ClassifierTaxonomy): string {
  let id = rawId;
  const seen = new Set<string>();
  while (taxonomy.retiredCategoryIds[id] && !seen.has(id)) {
    seen.add(id);
    id = taxonomy.retiredCategoryIds[id];
  }
  return taxonomy.categories.some((category) => category.id === id) ? id : "other";
}

function normalizeTaxonomy(taxonomy: ClassifierTaxonomy): ClassifierTaxonomy {
  const categories = [...taxonomy.categories].sort((a, b) => a.sortOrder - b.sortOrder);
  return { ...taxonomy, categories, retiredCategoryIds: taxonomy.retiredCategoryIds ?? {} };
}

function validateCategories(categories: CategoryDef[], old: ClassifierTaxonomy): void {
  if (!categories.some((category) => category.id === "other")) throw new Error("必须保留“其他”分类");
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const category of categories) {
    if (!category.id || !category.name) throw new Error("分类 ID 和名称不能为空");
    if (ids.has(category.id)) throw new Error("分类 ID 不能重复");
    if (names.has(category.name)) throw new Error("分类名称不能重复");
    if (old.retiredCategoryIds[category.id] && !old.categories.some((item) => item.id === category.id)) {
      throw new Error("已删除分类的 ID 不能重新使用");
    }
    ids.add(category.id);
    names.add(category.name);
  }
}
