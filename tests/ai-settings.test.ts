import assert from 'node:assert/strict';
import test from 'node:test';
import { isInvalidGeminiApiKeyMessage } from '../app/lib/ai-provider.ts';
import {
  DEFAULT_GEMINI_MODEL,
  FREE_GEMINI_MODELS,
} from '../app/lib/local-ai-settings.ts';

test('Gemini chỉ dùng một model Flash miễn phí tốt nhất', () => {
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.7-flash');
  assert.equal(FREE_GEMINI_MODELS.length, 1);
  assert.equal(FREE_GEMINI_MODELS[0].id, DEFAULT_GEMINI_MODEL);
});

test('nhận diện lỗi API Key dù Gemini trả HTTP 400', () => {
  assert.equal(isInvalidGeminiApiKeyMessage('API key not valid. Please pass a valid API key.'), true);
  assert.equal(isInvalidGeminiApiKeyMessage('quota exceeded'), false);
});
