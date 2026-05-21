import { useState, useEffect, useCallback } from "react";
import type { CategoryDef } from "../../../modules/types";

export function useCategories() {
  const [categories, setCategories] = useState<CategoryDef[]>([]);

  const refresh = useCallback(async () => {
    const res = await chrome.runtime.sendMessage({ type: "categories:list" });
    if (res?.success) {
      setCategories(res.data as CategoryDef[]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { categories, refresh };
}
