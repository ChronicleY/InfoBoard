import { useState, useEffect, useCallback } from "react";
import type { Article } from "../../../modules/types";

export function useNotices() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await chrome.runtime.sendMessage({ type: "notices:list" });
    if (res?.success) {
      setArticles(res.data as Article[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && (changes["meta:index"] || Object.keys(changes).some((key) => key.startsWith("articles:")))) refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refresh]);

  return { articles, loading, refresh };
}
