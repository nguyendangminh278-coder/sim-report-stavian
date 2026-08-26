import fs from 'node:fs';
import path from 'node:path';
import {
  ACCOUNT_OPTIONS,
  auditAiResult,
  buildExtractionAuditPrompt,
  buildExtractionPrompt,
  calculateTrade,
  createGeminiResponseSchema,
  extractionQualityScore,
  inferImageType,
  normalizePositions,
  normalizeTrades,
  type AiResult,
  type ImageType,
} from '../app/lib/report-v2.ts';
import { parseSimWorkbook } from '../app/lib/excel-report.ts';

try {
  process.loadEnvFile?.('.env.local');
} catch {
  // `.env.local` is optional; environment variables may be supplied by the shell.
}

const sourceRoot = process.env.SIM_REPORT_SOURCE_DIR;
const checkFile = process.env.SIM_REPORT_CHECK_FILE;
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const outputFile = process.env.SIM_REPORT_AUDIT_OUTPUT || '.xlsx-analysis/gemini-august-audit.json';

if (!sourceRoot || !checkFile || !apiKey) {
  throw new Error('Thiếu SIM_REPORT_SOURCE_DIR, SIM_REPORT_CHECK_FILE hoặc GEMINI_API_KEY trong .env.local.');
}

function normalizedName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function accountFromFile(fileName: string) {
  const name = normalizedName(fileName);
  if (/STONE\s*X|STONEX|\b39(?:1|4)\b/.test(name)) return null;
  if (/PG.*(?:BP)?.*8888?/.test(name)) return ACCOUNT_OPTIONS.find((item) => item.name === 'PG BP 888') || null;
  if (/PG.*(?:BP)?.*668/.test(name)) return ACCOUNT_OPTIONS.find((item) => item.name === 'PG BP 668') || null;
  if (/VIETIN/.test(name)) return ACCOUNT_OPTIONS.find((item) => item.name === 'Vietinbank') || null;
  if (/BIDV/.test(name)) return ACCOUNT_OPTIONS.find((item) => item.name === 'BIDV') || null;
  if (/PG.*SIM/.test(name)) return ACCOUNT_OPTIONS.find((item) => item.name === 'PG SIM') || null;
  return null;
}

function mimeType(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function strictSchema(type: ImageType) {
  const schema = structuredClone(createGeminiResponseSchema(type)) as {
    properties: Record<string, unknown>;
    required: string[];
  };
  const remove = type === 'positions'
    ? ['trades', 'trade_lines', 'visible_trade_line_count', 'visible_trade_pair_count']
    : type === 'trades'
      ? ['positions', 'visible_position_count', 'visible_ote_total']
      : [];
  for (const field of remove) {
    delete schema.properties[field];
    schema.required = schema.required.filter((item) => item !== field);
  }
  return schema;
}

async function callGemini(filePath: string, prompt: string, type: ImageType): Promise<AiResult> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey!)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inlineData: { mimeType: mimeType(filePath), data: fs.readFileSync(filePath).toString('base64') } },
          { text: prompt },
        ] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 12288,
          responseMimeType: 'application/json',
          responseSchema: strictSchema(type),
        },
      }),
    },
  );
  const payload = await response.json() as {
    error?: { message?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Gemini HTTP ${response.status}`);
  const raw = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  return JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()) as AiResult;
}

async function readImage(filePath: string, account: (typeof ACCOUNT_OPTIONS)[number], type: ImageType) {
  const basePrompt = buildExtractionPrompt(account.name, account.code, account.fee, path.basename(filePath), type);
  const first = await callGemini(filePath, basePrompt, type);
  const issues = auditAiResult(first, type);
  if (!issues.length) return { result: first, retried: false };
  const second = await callGemini(filePath, buildExtractionAuditPrompt(basePrompt, issues, first), type);
  return {
    result: extractionQualityScore(second, type) >= extractionQualityScore(first, type) ? second : first,
    retried: true,
  };
}

const images = fs.readdirSync(sourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{2}\.08$/.test(entry.name))
  .flatMap((directory) => fs.readdirSync(path.join(sourceRoot, directory.name), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp|gif)$/i.test(entry.name))
    .map((entry) => ({
      reportDate: `2026-08-${directory.name.slice(0, 2)}`,
      filePath: path.join(sourceRoot, directory.name, entry.name),
      fileName: entry.name,
    })))
  .filter((item) => !/STONE\s*X|STONEX|\b39(?:1|4)\b/i.test(normalizedName(item.fileName)))
  .sort((a, b) => a.filePath.localeCompare(b.filePath));

const workbookBytes = fs.readFileSync(checkFile);
const workbook = await parseSimWorkbook(workbookBytes.buffer.slice(
  workbookBytes.byteOffset,
  workbookBytes.byteOffset + workbookBytes.byteLength,
));
const expected = new Map<string, { trades: number; lots: number; pnlAfterFee: number }>();
for (const trade of workbook.trades) {
  if (/stone/i.test(trade.account || trade.bank)) continue;
  const key = `${trade.reportDate}|${trade.account || trade.bank}`;
  const item = expected.get(key) || { trades: 0, lots: 0, pnlAfterFee: 0 };
  item.trades += 1;
  item.lots += trade.lots || 0;
  item.pnlAfterFee += trade.pnlAfterFee || 0;
  expected.set(key, item);
}

const actual = new Map<string, { trades: number; lots: number; pnlAfterFee: number; positions: number }>();
const files: Array<Record<string, unknown>> = [];
for (const [index, image] of images.entries()) {
  const account = accountFromFile(image.fileName);
  const type = inferImageType(image.fileName);
  process.stdout.write(`[${index + 1}/${images.length}] ${image.reportDate} ${image.fileName}\n`);
  if (!account || type === 'auto') {
    files.push({ ...image, status: 'skipped', reason: !account ? 'Không nhận diện được tài khoản/STONEX' : 'Không nhận diện được PO/PS' });
    continue;
  }
  try {
    const { result, retried } = await readImage(image.filePath, account, type);
    const issues = auditAiResult(result, type);
    const positions = normalizePositions(result.positions);
    const trades = normalizeTrades(result.trades, result.trade_lines);
    const key = `${image.reportDate}|${account.name}`;
    const total = actual.get(key) || { trades: 0, lots: 0, pnlAfterFee: 0, positions: 0 };
    total.positions += positions.length;
    for (const trade of trades) {
      const calculated = calculateTrade(trade, account.fee);
      total.trades += 1;
      total.lots += trade.lots || 0;
      total.pnlAfterFee += calculated.afterFee || 0;
    }
    actual.set(key, total);
    files.push({
      reportDate: image.reportDate,
      fileName: image.fileName,
      account: account.name,
      type,
      status: issues.length ? 'review' : 'ok',
      retried,
      positions: positions.length,
      trades: trades.length,
      issues,
    });
  } catch (error) {
    files.push({ ...image, account: account.name, type, status: 'error', error: error instanceof Error ? error.message : String(error) });
  }
}

const keys = [...new Set([...expected.keys(), ...actual.keys()])].sort();
const comparisons = keys.map((key) => {
  const expectedValue = expected.get(key) || { trades: 0, lots: 0, pnlAfterFee: 0 };
  const actualValue = actual.get(key) || { trades: 0, lots: 0, pnlAfterFee: 0, positions: 0 };
  return {
    key,
    expected: expectedValue,
    actual: actualValue,
    matches: expectedValue.trades === actualValue.trades
      && Math.abs(expectedValue.lots - actualValue.lots) < 1e-9
      && Math.abs(expectedValue.pnlAfterFee - actualValue.pnlAfterFee) < 0.02,
  };
});
const audit = {
  generatedAt: new Date().toISOString(),
  model,
  imageCount: images.length,
  excluded: 'STONEX',
  checkWorkbookSourceMode: workbook.sourceMode,
  checkWorkbookWarnings: workbook.warnings,
  files,
  comparisons,
};
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(audit, null, 2), 'utf8');
console.log(`Đã ghi ${outputFile}. Khớp ${comparisons.filter((item) => item.matches).length}/${comparisons.length} nhóm ngày/tài khoản.`);
