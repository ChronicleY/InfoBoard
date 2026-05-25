import type { Settings } from "../types";

const DEFAULT_SETTINGS: Settings = {
  deepseekApiKey: "",
  deepseekModel: "deepseek-chat",
  subscriptions: [],
  userCollege: "",
  userCourses: [],
  llmUrl: "",
  storageDays: 7,
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
