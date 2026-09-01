'use client';

import {
  activeAiSettings,
  loadLocalAiSettings,
} from './local-ai-settings.ts';

export type AiJsonSchema = Record<string, unknown>;

export type AiImageInput = {
  mimeType: string;
  data: string;
};

export type AiSearchSource = {
  title: string;
  uri: string;
};

type ConfiguredJsonOptions = {
  prompt: string;
  schema: AiJsonSchema;
  schemaName: string;
  maxOutputTokens: number;
  images?: AiImageInput[];
};

function configuredSettings() {
  const active = activeAiSettings(loadLocalAiSettings());
  if (!active.apiKey) {
    throw new Error(`Chưa có ${active.providerLabel} API Key. Vào Đọc ảnh → Cấu hình AI để nhập và lưu khóa trên trình duyệt này.`);
  }
  if (!active.model) throw new Error(`Chưa chọn model ${active.providerLabel}.`);
  return active;
}

function cleanJsonText(value: string) {
  return value.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
}

function normalizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonSchema);
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(input)) {
    if (key === 'nullable') continue;
    if (key === 'type' && typeof item === 'string') output[key] = item.toLowerCase();
    else output[key] = normalizeJsonSchema(item);
  }
  if (String(output.type).toLowerCase() === 'object') output.additionalProperties = false;
  return output;
}

function openAiOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === 'string') return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = Array.isArray((item as { content?: unknown[] }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const typed = part as { type?: string; text?: string };
      if (typed.type === 'output_text' && typed.text) parts.push(typed.text);
    }
  }
  return parts.join('\n').trim();
}

function openAiError(status: number, message: string, model: string) {
  if (status === 401 || status === 403) return new Error('OpenAI API Key không hợp lệ hoặc chưa được cấp quyền.');
  if (status === 429) return new Error('OpenAI đã hết hạn mức hoặc số dư API. Kiểm tra Billing rồi thử lại.');
  if (status === 404) return new Error(`Model “${model}” không khả dụng cho API Key này.`);
  return new Error(`OpenAI lỗi ${status}: ${message || 'Không xử lý được yêu cầu.'}`);
}

type GeminiPayload = {
  error?: { code?: number; message?: string };
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

function geminiError(code: number, message: string, model: string) {
  if (isInvalidGeminiApiKeyMessage(message)) {
    return new Error('Gemini API Key không hợp lệ. Hãy tạo key mới trong Google AI Studio rồi nhập lại.');
  }
  if (code === 429) return new Error(`Model “${model}” đang hết quota miễn phí tạm thời.`);
  if (code === 401) return new Error('Gemini API Key không hợp lệ. Hãy tạo lại key trong Google AI Studio.');
  if (code === 403) {
    return new Error('Gemini API Key chưa được cấp quyền, Generative Language API chưa bật, hoặc key đang chặn tên miền GitHub Pages.');
  }
  if (code === 404) return new Error(`Model “${model}” chưa khả dụng cho API Key này.`);
  if (code === 400) return new Error(`Gemini không chấp nhận yêu cầu với model “${model}”: ${message || 'yêu cầu không hợp lệ'}.`);
  return new Error(`Gemini lỗi ${code}: ${message || 'Không xử lý được dữ liệu.'}`);
}

export function isInvalidGeminiApiKeyMessage(message = '') {
  return /api key not valid|invalid api key|api_key_invalid/i.test(message);
}

async function callGeminiModel<T>(
  options: ConfiguredJsonOptions,
  apiKey: string,
  model: string,
): Promise<{ value: T; model: string }> {
  const parts = [
    ...(options.images || []).map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } })),
    { text: options.prompt },
  ];
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: options.maxOutputTokens,
          responseMimeType: 'application/json',
          responseSchema: options.schema,
        },
      }),
    },
  );
  const payload = await response.json() as GeminiPayload;
  if (!response.ok || payload.error) {
    const code = payload.error?.code || response.status;
    const message = payload.error?.message || 'Gemini không xử lý được dữ liệu.';
    const error = geminiError(code, message, model) as Error & { code?: number; apiMessage?: string };
    error.code = code;
    error.apiMessage = message;
    throw error;
  }
  const raw = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
  if (!raw) throw new Error('Gemini trả về kết quả rỗng.');
  try {
    return { value: JSON.parse(cleanJsonText(raw)) as T, model };
  } catch {
    throw new Error('Gemini trả về JSON không hợp lệ. Hãy thử lại.');
  }
}

async function callGeminiJson<T>(options: ConfiguredJsonOptions, apiKey: string, selectedModel: string): Promise<T> {
  const result = await callGeminiModel<T>(options, apiKey, selectedModel);
  return result.value;
}

export async function testGeminiApiConnection(apiKey: string, selectedModel: string) {
  const key = apiKey.trim();
  if (!key) throw new Error('Chưa nhập Gemini API Key.');
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
    headers: { 'x-goog-api-key': key },
  });
  const payload = await response.json() as {
    error?: { code?: number; message?: string };
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };
  if (!response.ok || payload.error) {
    const code = payload.error?.code || response.status;
    throw geminiError(code, payload.error?.message || '', selectedModel);
  }
  const available = new Set((payload.models || [])
    .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
    .map((model) => (model.name || '').replace(/^models\//, ''))
    .filter(Boolean));
  if (!available.has(selectedModel)) {
    throw new Error(`API Key hợp lệ nhưng chưa được cấp quyền dùng ${selectedModel}.`);
  }
  return {
    model: selectedModel,
    message: `Kết nối thành công với ${selectedModel}.`,
  };
}

async function callOpenAiJson<T>(options: ConfiguredJsonOptions, apiKey: string, model: string): Promise<T> {
  const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: options.prompt }];
  for (const image of options.images || []) {
    content.push({
      type: 'input_image',
      image_url: `data:${image.mimeType};base64,${image.data}`,
      detail: 'high',
    });
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      store: false,
      input: [{ role: 'user', content }],
      max_output_tokens: Math.min(options.maxOutputTokens, 16_384),
      text: {
        format: {
          type: 'json_schema',
          name: options.schemaName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
          strict: true,
          schema: normalizeJsonSchema(options.schema),
        },
      },
    }),
  });
  let payload: Record<string, unknown>;
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    payload = {};
  }
  if (!response.ok || payload.error) {
    const error = payload.error && typeof payload.error === 'object' ? payload.error as { message?: string } : {};
    throw openAiError(response.status, error.message || '', model);
  }
  const raw = openAiOutputText(payload);
  if (!raw) throw new Error('GPT-4o mini trả về kết quả rỗng.');
  try {
    return JSON.parse(cleanJsonText(raw)) as T;
  } catch {
    throw new Error('GPT-4o mini trả về JSON không hợp lệ. Hãy thử lại.');
  }
}

export async function callConfiguredAiJson<T>(options: ConfiguredJsonOptions): Promise<T> {
  const active = configuredSettings();
  return active.provider === 'openai'
    ? callOpenAiJson<T>(options, active.apiKey, active.model)
    : callGeminiJson<T>(options, active.apiKey, active.model);
}

function uniqueSources(sources: AiSearchSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const uri = source.uri.trim();
    if (!uri || seen.has(uri)) return false;
    seen.add(uri);
    return true;
  });
}

export async function callConfiguredOpenAiSearch(
  prompt: string,
  maxOutputTokens: number,
  timeoutMs: number,
  maxToolCalls = 10,
) {
  const active = configuredSettings();
  if (active.provider !== 'openai') throw new Error('Nhà cung cấp AI hiện tại không phải OpenAI.');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${active.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: active.model,
        store: false,
        input: prompt,
        tools: [{ type: 'web_search' }],
        tool_choice: 'auto',
        include: ['web_search_call.action.sources'],
        max_tool_calls: maxToolCalls,
        max_output_tokens: Math.min(maxOutputTokens, 16_384),
      }),
    });
    let payload: Record<string, unknown>;
    try {
      payload = await response.json() as Record<string, unknown>;
    } catch {
      payload = {};
    }
    if (!response.ok || payload.error) {
      const error = payload.error && typeof payload.error === 'object' ? payload.error as { message?: string } : {};
      throw openAiError(response.status, error.message || '', active.model);
    }
    const text = openAiOutputText(payload);
    if (!text) throw new Error('GPT-4o mini trả về báo cáo rỗng. Hãy thử lại.');

    const sources: AiSearchSource[] = [];
    const queries: string[] = [];
    for (const item of Array.isArray(payload.output) ? payload.output : []) {
      if (!item || typeof item !== 'object') continue;
      const typed = item as {
        type?: string;
        action?: { query?: string; queries?: string[]; sources?: Array<{ title?: string; url?: string }> };
        content?: Array<{ annotations?: Array<{ type?: string; title?: string; url?: string }> }>;
      };
      if (typed.action?.query) queries.push(typed.action.query);
      for (const query of typed.action?.queries || []) queries.push(query);
      for (const source of typed.action?.sources || []) {
        if (source.url) sources.push({ title: source.title || 'Nguồn tìm kiếm', uri: source.url });
      }
      for (const part of typed.content || []) {
        for (const annotation of part.annotations || []) {
          if (annotation.url) sources.push({ title: annotation.title || 'Nguồn trích dẫn', uri: annotation.url });
        }
      }
    }
    return {
      text,
      sources: uniqueSources(sources),
      queries: [...new Set(queries.filter(Boolean))],
      generatedAt: new Date().toISOString(),
      searchEntryPointHtml: '',
      usedTimeFilter: false,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Tìm kiếm OpenAI mất quá nhiều thời gian. Hãy thu hẹp khoảng ngày hoặc thử lại.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
