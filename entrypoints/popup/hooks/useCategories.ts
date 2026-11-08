import { useState, useEffect, useCallback } from "react";
import type { CategoryDef, ClassifierTaxonomy } from "../../../modules/types";

export function useCategories() {
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(async () => {
    const res = await chrome.runtime.sendMessage({ type: "categories:list" });
    if (res?.success) {
      const taxonomy = res.data as ClassifierTaxonomy;
      setCategories(taxonomy.categories);
      setRevision(taxonomy.revision);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes["meta:classifierTaxonomy"]) refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refresh]);

  return { categories, revision, refresh };
}
