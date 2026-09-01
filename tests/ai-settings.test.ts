import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldTryNextGeminiModel } from '../app/lib/ai-provider.ts';
import {
  DEFAULT_GEMINI_MODEL,
  FREE_GEMINI_MODELS,
  geminiModelCandidates,
} from '../app/lib/local-ai-settings.ts';

test('Gemini mặc định dùng Flash-Lite miễn phí ổn định', () => {
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-2.5-flash-lite');
  assert.ok(FREE_GEMINI_MODELS.every((model) => model.note.includes('Miễn phí')));
});

test('giữ model người dùng chọn rồi tự thêm các model miễn phí dự phòng', () => {
  assert.deepEqual(geminiModelCandidates('gemini-3.5-flash-lite'), [
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
  ]);
});

test('chỉ đổi model khi lỗi model hoặc quota, không che lỗi API key', () => {
  assert.equal(shouldTryNextGeminiModel(404, 'model not found'), true);
  assert.equal(shouldTryNextGeminiModel(429, 'quota exceeded'), true);
  assert.equal(shouldTryNextGeminiModel(400, 'response schema not supported'), true);
  assert.equal(shouldTryNextGeminiModel(403, 'API key forbidden'), false);
});
