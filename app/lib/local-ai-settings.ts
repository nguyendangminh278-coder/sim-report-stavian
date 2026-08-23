'use client';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

const API_KEY_STORAGE = 'sim_report_gemini_key';
const MODEL_STORAGE = 'sim_report_model';

export type LocalAiSettings = {
  geminiApiKey: string;
  model: string;
};

export function loadLocalAiSettings(): LocalAiSettings {
  if (typeof window === 'undefined') {
    return { geminiApiKey: '', model: DEFAULT_GEMINI_MODEL };
  }
  return {
    geminiApiKey: localStorage.getItem(API_KEY_STORAGE)
      || sessionStorage.getItem(API_KEY_STORAGE)
      || '',
    model: localStorage.getItem(MODEL_STORAGE) || DEFAULT_GEMINI_MODEL,
  };
}

export function saveLocalAiSettings(settings: LocalAiSettings) {
  localStorage.setItem(API_KEY_STORAGE, settings.geminiApiKey.trim());
  localStorage.setItem(MODEL_STORAGE, settings.model.trim() || DEFAULT_GEMINI_MODEL);
  sessionStorage.removeItem(API_KEY_STORAGE);
}
