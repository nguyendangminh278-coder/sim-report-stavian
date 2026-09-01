'use client';

export type AiProvider = 'gemini' | 'openai';

export const FREE_GEMINI_MODELS = [
  {
    id: 'gemini-3.7-flash',
    label: 'Gemini 3.7 Flash',
    note: 'Miễn phí · chất lượng cao nhất',
  },
] as const;

export const DEFAULT_GEMINI_MODEL = FREE_GEMINI_MODELS[0].id;
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

const PROVIDER_STORAGE = 'sim_report_ai_provider';
const GEMINI_API_KEY_STORAGE = 'sim_report_gemini_key';
const OPENAI_API_KEY_STORAGE = 'sim_report_openai_key';
const LEGACY_MODEL_STORAGE = 'sim_report_model';
const GEMINI_MODEL_STORAGE = 'sim_report_gemini_model';
const OPENAI_MODEL_STORAGE = 'sim_report_openai_model';
const SETTINGS_VERSION_STORAGE = 'sim_report_ai_settings_version';
const CURRENT_SETTINGS_VERSION = '3';

export type LocalAiSettings = {
  provider: AiProvider;
  geminiApiKey: string;
  openAiApiKey: string;
  geminiModel: string;
  openAiModel: string;
  /** Active model alias retained for older call sites. */
  model: string;
};

function emptySettings(): LocalAiSettings {
  return {
    provider: 'gemini',
    geminiApiKey: '',
    openAiApiKey: '',
    geminiModel: DEFAULT_GEMINI_MODEL,
    openAiModel: DEFAULT_OPENAI_MODEL,
    model: DEFAULT_GEMINI_MODEL,
  };
}

export function loadLocalAiSettings(): LocalAiSettings {
  if (typeof window === 'undefined') return emptySettings();
  const storedProvider = localStorage.getItem(PROVIDER_STORAGE);
  const provider: AiProvider = storedProvider === 'openai' ? 'openai' : 'gemini';
  const settingsVersion = localStorage.getItem(SETTINGS_VERSION_STORAGE);
  const geminiModel = DEFAULT_GEMINI_MODEL;
  if (settingsVersion !== CURRENT_SETTINGS_VERSION) {
    localStorage.setItem(GEMINI_MODEL_STORAGE, geminiModel);
    localStorage.setItem(LEGACY_MODEL_STORAGE, geminiModel);
    localStorage.setItem(SETTINGS_VERSION_STORAGE, CURRENT_SETTINGS_VERSION);
  }
  const openAiModel = localStorage.getItem(OPENAI_MODEL_STORAGE) || DEFAULT_OPENAI_MODEL;
  return {
    provider,
    geminiApiKey: localStorage.getItem(GEMINI_API_KEY_STORAGE)
      || sessionStorage.getItem(GEMINI_API_KEY_STORAGE)
      || '',
    openAiApiKey: localStorage.getItem(OPENAI_API_KEY_STORAGE)
      || sessionStorage.getItem(OPENAI_API_KEY_STORAGE)
      || '',
    geminiModel,
    openAiModel,
    model: provider === 'openai' ? openAiModel : geminiModel,
  };
}

export function activeAiSettings(settings = loadLocalAiSettings()) {
  return settings.provider === 'openai'
    ? {
        provider: settings.provider,
        providerLabel: 'OpenAI',
        apiKey: settings.openAiApiKey.trim(),
        model: settings.openAiModel.trim() || DEFAULT_OPENAI_MODEL,
      }
    : {
        provider: settings.provider,
        providerLabel: 'Gemini',
        apiKey: settings.geminiApiKey.trim(),
        model: settings.geminiModel.trim() || DEFAULT_GEMINI_MODEL,
      };
}

export function saveLocalAiSettings(next: Partial<LocalAiSettings>) {
  const current = loadLocalAiSettings();
  const provider: AiProvider = next.provider === 'openai' ? 'openai' : next.provider === 'gemini' ? 'gemini' : current.provider;
  const geminiApiKey = (next.geminiApiKey ?? current.geminiApiKey).trim();
  const openAiApiKey = (next.openAiApiKey ?? current.openAiApiKey).trim();
  const geminiModel = DEFAULT_GEMINI_MODEL;
  const openAiModel = (next.openAiModel ?? (provider === 'openai' ? next.model : undefined) ?? current.openAiModel).trim()
    || DEFAULT_OPENAI_MODEL;

  localStorage.setItem(PROVIDER_STORAGE, provider);
  localStorage.setItem(GEMINI_API_KEY_STORAGE, geminiApiKey);
  localStorage.setItem(OPENAI_API_KEY_STORAGE, openAiApiKey);
  localStorage.setItem(GEMINI_MODEL_STORAGE, geminiModel);
  localStorage.setItem(OPENAI_MODEL_STORAGE, openAiModel);
  localStorage.setItem(LEGACY_MODEL_STORAGE, geminiModel);
  localStorage.setItem(SETTINGS_VERSION_STORAGE, CURRENT_SETTINGS_VERSION);
  sessionStorage.removeItem(GEMINI_API_KEY_STORAGE);
  sessionStorage.removeItem(OPENAI_API_KEY_STORAGE);
}
