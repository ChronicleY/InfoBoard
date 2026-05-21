import type { Settings } from "../types";

const DEFAULT_SETTINGS: Settings = {
  deepseekApiKey: "",
  deepseekModel: "deepseek-chat",
  subscriptions: ["学生事务", "荔园生活", "教师事务", "网上服务"],
};

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get("settings");
  return result.settings ? { ...DEFAULT_SETTINGS, ...result.settings } : DEFAULT_SETTINGS;
}

export async function saveSettings(partial: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  await chrome.storage.local.set({ settings: updated });
}
