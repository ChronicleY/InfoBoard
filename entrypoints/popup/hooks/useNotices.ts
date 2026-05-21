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

  return { articles, loading, refresh };
}
