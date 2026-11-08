import type { Settings } from "../types";

const DEFAULT_SETTINGS: Settings = {
  userCollege: "",
  userCourses: [],
  storageDays: 7,
};

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get("settings");
  const settings = { ...DEFAULT_SETTINGS, ...(result.settings ?? {}) } as Settings & { deepseekApiKey?: string };
  if ("deepseekApiKey" in settings) {
    delete settings.deepseekApiKey;
    await chrome.storage.local.set({ settings });
  }
  return settings;
}

export async function saveSettings(partial: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  await chrome.storage.local.set({ settings: updated });
}
