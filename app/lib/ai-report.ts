'use client';

import { parseSimWorkbook, type TradeRecord } from './excel-report.ts';
import { loadLocalAiSettings } from './local-ai-settings.ts';

type GeminiSchema = Record<string, unknown>;

export type AiExtractedTrade = {
  sourceSheet: string;
  sourceRow: string;
  sourceStt: string;
  reportDate: string;
  account: string;
  trader: string;
  openDate: string;
  closeDate: string;
  expiryDate: string;
  contractCode: string;
  commodity: string;
  position: string;
  openPrice: string;
  closePrice: string;
  lots: string;
  carryPrice: string;
};

type RawAiExtraction = {
  trades?: AiExtractedTrade[];
  warnings?: string[];
};

export type AiTradeExtraction = {
  trades: TradeRecord[];
  monthLabel: string;
  warnings: string[];
  sourceSheetCount: number;
};

export type WeeklyAiReview = {
  trades: TradeRecord[];
  notes: string[];
};

type SerializedRow = { row: number; cells: Array<{ column: string; value: string }> };
type SerializedBlock = {
  accountHint: string;
  titleRow: number;
  rows: SerializedRow[];
};
type SerializedSheet = { sheet: string; blocks: SerializedBlock[] };

const EXTRACTION_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    trades: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          sourceSheet: { type: 'STRING' },
          sourceRow: { type: 'STRING' },
          sourceStt: { type: 'STRING' },
          reportDate: { type: 'STRING' },
          account: { type: 'STRING' },
          trader: { type: 'STRING' },
          openDate: { type: 'STRING' },
          closeDate: { type: 'STRING' },
          expiryDate: { type: 'STRING' },
          contractCode: { type: 'STRING' },
          commodity: { type: 'STRING' },
          position: { type: 'STRING' },
          openPrice: { type: 'STRING' },
          closePrice: { type: 'STRING' },
          lots: { type: 'STRING' },
          carryPrice: { type: 'STRING' },
        },
        required: [
          'sourceSheet', 'sourceRow', 'sourceStt', 'reportDate', 'account', 'trader',
          'openDate', 'closeDate', 'expiryDate', 'contractCode', 'commodity', 'position',
          'openPrice', 'closePrice', 'lots', 'carryPrice',
        ],
      },
    },
    warnings: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['trades', 'warnings'],
};

const WEEKLY_REVIEW_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    rows: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          rowIndex: { type: 'INTEGER' },
          trader: { type: 'STRING' },
          account: { type: 'STRING' },
          commodity: { type: 'STRING' },
        },
        required: ['rowIndex', 'trader', 'account', 'commodity'],
      },
    },
    notes: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['rows', 'notes'],
};

function normalizeText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value ?? '').trim().replace(/\s+/g, '').replace(/[$€£₫]/g, '');
  if (!text || /^n\/?a$/i.test(text) || text === '-') return null;
  if (text.includes(',') && text.includes('.')) {
    text = text.lastIndexOf('.') > text.lastIndexOf(',')
      ? text.replace(/,/g, '')
      : text.replace(/\./g, '').replace(',', '.');
  } else if (text.includes(',')) {
    const parts = text.split(',');
    text = parts.length === 2 && parts[1].length <= 2
      ? `${parts[0]}.${parts[1]}`
      : parts.join('');
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function isoDate(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const vn = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!vn) return text;
  const year = vn[3].length === 2 ? `20${vn[3]}` : vn[3];
  return `${year}-${vn[2].padStart(2, '0')}-${vn[1].padStart(2, '0')}`;
}

function canonicalAccount(value: string): string {
  const normalized = normalizeText(value);
  if (normalized.includes('vietin')) return 'Vietinbank';
  if (normalized.includes('bidv')) return 'BIDV';
  if (/p[gb] bp (?:668|8668)\b/.test(normalized)) return 'PG BP 668';
  if (/p[gb] bp (?:888|8888)\b/.test(normalized)) return 'PG BP 888';
  if (normalized.includes('pg') && normalized.includes('sim')) return 'PG SIM';
  if (normalized.includes('stone')) return 'STONEX';
  return value.trim();
}

function bankForAccount(account: string): string {
  const normalized = normalizeText(account);
  if (normalized.includes('vietin')) return 'VietinBank';
  if (normalized.includes('bidv')) return 'BIDV';
  if (normalized.includes('pg')) return 'PG Bank';
  if (normalized.includes('stone')) return 'StoneX';
  return '';
}

function feeForAccount(account: string): number | null {
  const normalized = normalizeText(account);
  if (normalized.includes('vietin')) return 0.616;
  if (normalized.includes('bidv')) return 0.66;
  if (normalized.includes('pg')) return 0.572;
  if (normalized.includes('stone')) return 0.7936;
  return null;
}

function commodityFor(code: string, aiValue: string): string {
  const normalized = code.replace(/\s/g, '').toUpperCase();
  if (normalized.startsWith('AHDD') || normalized.startsWith('LALZ')) return 'Nhôm';
  if (normalized.startsWith('LDKZ')) return 'Đồng';
  if (normalized.startsWith('ZDSD') || normalized.startsWith('LZHZ')) return 'Kẽm';
  return aiValue.trim();
}

function canonicalPosition(value: string): string {
  const normalized = normalizeText(value);
  if (['long', 'mua', 'l'].includes(normalized)) return 'Long';
  if (['short', 'ban', 's', 'b'].includes(normalized)) return 'Short';
  return value.trim();
}

function round(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function normalizeSettledTradeFromAi(raw: AiExtractedTrade): TradeRecord | null {
  const account = canonicalAccount(raw.account || '');
  const position = canonicalPosition(raw.position || '');
  const openPrice = asNumber(raw.openPrice);
  const closePrice = asNumber(raw.closePrice);
  const lots = asNumber(raw.lots);
  const openDate = isoDate(raw.openDate);
  const closeDate = isoDate(raw.closeDate);
  const contractCode = String(raw.contractCode || '').trim();
  const sourceStt = String(raw.sourceStt || '').trim();
  const sourceRow = asNumber(raw.sourceRow);

  // A settled row must be a numbered line in the accounting table. Blank-STT
  // rows are stale worksheet remnants and must never be inferred as trades.
  if (
    !/^[1-9]\d*$/.test(sourceStt) ||
    sourceRow === null ||
    sourceRow <= 0 ||
    !openDate ||
    !closeDate ||
    !contractCode ||
    openPrice === null ||
    closePrice === null ||
    !lots ||
    lots <= 0
  ) {
    return null;
  }
  if (position !== 'Long' && position !== 'Short') return null;

  const tonnes = round(lots * 25);
  const feeRate = feeForAccount(account);
  const totalFee = feeRate === null ? null : round(tonnes * feeRate * 2);
  const pnlBeforeFee = round(
    (position === 'Long' ? closePrice - openPrice : openPrice - closePrice) * tonnes,
  );
  const pnlAfterFee = totalFee === null ? null : round(pnlBeforeFee - totalFee);

  return {
    reportDate: isoDate(raw.reportDate) || closeDate,
    bank: bankForAccount(account),
    account,
    sourceSheet: String(raw.sourceSheet || '').trim(),
    sourceRow,
    sourceStt,
    trader: String(raw.trader || '').trim(),
    openDate,
    closeDate,
    expiryDate: isoDate(raw.expiryDate),
    contractCode,
    commodity: commodityFor(contractCode, raw.commodity || ''),
    position,
    openPrice,
    closePrice,
    lots,
    tonnes,
    feeRate,
    totalFee,
    carryPrice: asNumber(raw.carryPrice),
    pnlBeforeFee,
    pnlAfterFee,
  };
}

function sourceLocationKey(trade: Pick<TradeRecord, 'sourceSheet' | 'sourceRow'>) {
  return `${normalizeText(trade.sourceSheet)}|${String(trade.sourceRow).trim()}`;
}

function deduplicateTrades(trades: TradeRecord[]) {
  const seen = new Set<string>();
  return trades.filter((trade) => {
    const key = sourceLocationKey(trade);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeAiLabelsIntoSource(source: TradeRecord, aiTrade: TradeRecord): TradeRecord {
  const account = canonicalAccount(source.account || aiTrade.account);
  const trader = source.trader.trim() || aiTrade.trader.trim();
  const commodity = commodityFor(source.contractCode, source.commodity || aiTrade.commodity);

  // Excel's settled row is the financial source of truth. AI may fill labels,
  // but it must never alter dates, quantities, fees or P&L.
  return {
    ...source,
    account,
    bank: source.bank || bankForAccount(account),
    trader,
    commodity,
  };
}

export function reconcileExtractedTrades(
  sourceTrades: TradeRecord[],
  aiTrades: TradeRecord[],
): { trades: TradeRecord[]; missingFromAi: number; extraFromAi: number } {
  const sourceRows = deduplicateTrades(sourceTrades);
  const aiRows = deduplicateTrades(aiTrades);
  if (!sourceRows.length) return { trades: aiRows, missingFromAi: 0, extraFromAi: 0 };

  const aiByLocation = new Map(aiRows.map((trade) => [sourceLocationKey(trade), trade]));
  const sourceLocations = new Set(sourceRows.map(sourceLocationKey));
  let missingFromAi = 0;
  const trades = sourceRows.map((source) => {
    const aiTrade = aiByLocation.get(sourceLocationKey(source));
    if (!aiTrade) {
      missingFromAi += 1;
      return source;
    }
    return mergeAiLabelsIntoSource(source, aiTrade);
  });
  const extraFromAi = aiRows.filter((trade) => !sourceLocations.has(sourceLocationKey(trade))).length;
  return { trades, missingFromAi, extraFromAi };
}

function monthLabelFromTrades(trades: TradeRecord[]) {
  const months = new Map<number, number>();
  for (const trade of trades) {
    const match = trade.reportDate.match(/^\d{4}-(\d{2})-\d{2}$/);
    if (!match) continue;
    const month = Number(match[1]);
    months.set(month, (months.get(month) || 0) + 1);
  }
  const month = [...months.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return month ? `Tháng ${month}` : 'Tháng';
}

async function callGeminiJson<T>(
  prompt: string,
  schema: GeminiSchema,
  maxOutputTokens: number,
): Promise<T> {
  const settings = loadLocalAiSettings();
  const apiKey = settings.geminiApiKey.trim();
  const model = settings.model.trim();
  if (!apiKey || !model) {
    throw new Error('Chưa có Gemini API Key. Vào phần Đọc ảnh → Cấu hình AI để nhập và lưu khóa trên trình duyệt này.');
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens,
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      }),
    },
  );
  const payload = await response.json() as {
    error?: { code?: number; message?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (!response.ok || payload.error) {
    const code = payload.error?.code || response.status;
    const message = payload.error?.message || 'Gemini không xử lý được dữ liệu.';
    if (code === 429) throw new Error('Gemini đã hết quota tạm thời. Hãy đợi rồi thử lại.');
    if (code === 401 || code === 403) throw new Error('Gemini API Key không hợp lệ hoặc chưa được cấp quyền.');
    if (code === 404) throw new Error(`Model “${model}” không khả dụng. Hãy đổi model trong Cấu hình AI.`);
    throw new Error(`Gemini lỗi ${code}: ${message}`);
  }
  const raw = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
  if (!raw) throw new Error('Gemini trả về kết quả rỗng.');
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(clean) as T;
  } catch {
    throw new Error('Gemini trả về JSON không hợp lệ. Hãy thử lại.');
  }
}

function columnName(number: number) {
  let current = number;
  let name = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function accountHintFromText(value: string): string {
  const account = canonicalAccount(value);
  return account === value.trim() ? '' : account;
}

export async function serializeDailySheets(input: ArrayBuffer): Promise<SerializedSheet[]> {
  const imported = await import('exceljs');
  const ExcelJS = (imported.default || imported) as typeof import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input as never);
  const dailySheets = workbook.worksheets.filter((sheet) => {
    const name = normalizeText(sheet.name);
    return name.startsWith('ngay ') || /^\d{1,2}[ .\/-]\d{1,2}/.test(sheet.name.trim());
  });

  return dailySheets.map((sheet) => {
    const blocks: SerializedBlock[] = [];
    let currentBlock: SerializedBlock | null = null;
    let lastAccountHint = '';
    let blankRows = 0;

    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const cells: SerializedRow['cells'] = [];
      const seenMergedCells = new Set<string>();
      const columnCount = Math.min(Math.max(row.cellCount, sheet.columnCount), 22);
      for (let column = 1; column <= columnCount; column += 1) {
        const cell = row.getCell(column);
        if (cell.value === null || cell.value === undefined) continue;
        if (cell.isMerged) {
          const masterAddress = cell.master.address;
          if (seenMergedCells.has(masterAddress)) continue;
          seenMergedCells.add(masterAddress);
        }
        let value = '';
        try {
          value = cell.text.trim();
        } catch {
          const raw = cell.value;
          if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
            value = String(raw).trim();
          }
        }
        if (value) cells.push({ column: columnName(column), value });
      }

      const serializedRow = { row: rowNumber, cells };
      const rowText = cells.map((cell) => cell.value).join(' ');
      const normalizedRow = normalizeText(rowText);
      const rowAccountHint = accountHintFromText(rowText);

      if (normalizedRow.includes('vi the dang co')) {
        currentBlock = null;
        blankRows = 0;
        if (rowAccountHint) lastAccountHint = rowAccountHint;
        continue;
      }

      if (normalizedRow.includes('hach toan loi nhuan giao dich')) {
        currentBlock = {
          accountHint: rowAccountHint || lastAccountHint,
          titleRow: rowNumber,
          rows: [serializedRow],
        };
        blocks.push(currentBlock);
        blankRows = 0;
        continue;
      }

      if (!currentBlock) continue;
      if (!cells.length) {
        blankRows += 1;
        if (blankRows >= 3) currentBlock = null;
        continue;
      }
      blankRows = 0;
      currentBlock.rows.push(serializedRow);
    }
    return {
      sheet: sheet.name,
      blocks: blocks.filter((block) => block.rows.some((blockRow) => {
        const text = normalizeText(blockRow.cells.map((cell) => cell.value).join(' '));
        return text.includes('nguoi thuc hien') && text.includes('ngay mo lenh') && text.includes('ngay tat toan');
      })),
    };
  }).filter((sheet) => sheet.blocks.length > 0);
}

function chunkSheets(sheets: SerializedSheet[], maxCharacters = 52000) {
  const chunks: SerializedSheet[][] = [];
  let current: SerializedSheet[] = [];
  let currentSize = 0;
  for (const sheet of sheets) {
    const size = JSON.stringify(sheet).length;
    if (current.length && currentSize + size > maxCharacters) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(sheet);
    currentSize += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function extractionPrompt(chunk: SerializedSheet[]) {
  return `Bạn là AI kiểm toán sổ lệnh LME. Hãy đọc dữ liệu ô Excel dưới đây và chỉ xuất các lệnh ĐÃ HẠCH TOÁN.

QUY TẮC BẮT BUỘC:
- Chỉ lấy dòng thuộc bảng có tiêu đề "HẠCH TOÁN LỢI NHUẬN GIAO DỊCH" trong từng sheet ngày.
- Bỏ toàn bộ bảng "Vị thế đang có", Positions, OTE, báo cáo tuần và mọi dòng tổng.
- Một lệnh đã hạch toán phải có ngày mở, ngày tất toán, giá mở, giá đóng, khối lượng lot và vị thế Long/Short. Thiếu một trong các dữ liệu cốt lõi này thì không xuất.
- Mỗi block đã có accountHint lấy từ tiêu đề gần nhất. Dùng accountHint cho toàn bộ lệnh trong block; chỉ thay đổi nếu tiêu đề hạch toán ghi rõ tài khoản khác.
- Chuẩn hóa PG BP 8668 thành PG BP 668 và PG/PB BP 8888 thành PG BP 888.
- Ô gộp "Người thực hiện" áp dụng cho các dòng lệnh liên tiếp trong cùng khối bảng.
- sourceSheet phải đúng tên sheet; sourceRow là số dòng Excel; sourceStt là STT nhìn thấy trong bảng.
- Chỉ xuất dòng có sourceStt là số nguyên dương nhìn thấy rõ. STT trống hoặc 0 thì bỏ qua, tuyệt đối không tự điền STT.
- Hai dòng có dữ liệu giống hệt nhưng sourceRow khác nhau là hai giao dịch thật: phải xuất đủ cả hai, không gộp và không loại trùng.
- reportDate lấy từ ngày báo cáo/tên sheet, định dạng YYYY-MM-DD. Các ngày khác cũng dùng YYYY-MM-DD.
- Không tự đoán dữ liệu. Trường không nhìn thấy để chuỗi rỗng.
- Số dùng dấu chấm thập phân, không có dấu phân tách hàng nghìn.
- Mặt hàng: AHDD/LALZ = Nhôm; LDKZ = Đồng; ZDSD/LZHZ = Kẽm.
- Vị thế chỉ là Long hoặc Short.
- Không tính phí và lợi nhuận; website sẽ đối soát bằng công thức sau khi AI trích xuất.

DỮ LIỆU CÁC BLOCK HẠCH TOÁN (mỗi cell có cột và giá trị, mỗi row giữ nguyên số dòng Excel):
${JSON.stringify(chunk)}`;
}

export async function extractSettledTradesWithAi(
  input: ArrayBuffer,
  onProgress?: (done: number, total: number) => void,
): Promise<AiTradeExtraction> {
  const parsedSource = await parseSimWorkbook(input);
  const sheets = await serializeDailySheets(input);
  if (!sheets.length) {
    throw new Error('Không tìm thấy sheet ngày trong workbook. AI chỉ đọc các sheet ngày để tránh lấy lại bảng tổng hợp cũ.');
  }
  const chunks = chunkSheets(sheets);
  const rawTrades: AiExtractedTrade[] = [];
  const warnings: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const result = await callGeminiJson<RawAiExtraction>(

      extractionPrompt(chunks[index]),
      EXTRACTION_SCHEMA,
      32768,
    );
    rawTrades.push(...(result.trades || []));
    warnings.push(...(result.warnings || []));
    onProgress?.(index + 1, chunks.length);
  }
  const normalizedAiTrades = deduplicateTrades(
    rawTrades.map(normalizeSettledTradeFromAi).filter((trade): trade is TradeRecord => Boolean(trade)),
  );
  const reconciled = reconcileExtractedTrades(parsedSource.trades, normalizedAiTrades);
  const trades = reconciled.trades.sort((a, b) => `${a.reportDate}|${a.sourceSheet}|${a.sourceRow}`.localeCompare(`${b.reportDate}|${b.sourceSheet}|${b.sourceRow}`, 'vi'));
  const rejected = rawTrades.length - normalizedAiTrades.length;
  if (rejected > 0) warnings.push(`${rejected} dòng AI trả về đã bị loại vì STT trống, thiếu điều kiện hạch toán hoặc trùng dòng gốc.`);
  if (reconciled.missingFromAi > 0) warnings.push(`AI bỏ sót ${reconciled.missingFromAi} dòng có STT hợp lệ; website đã khôi phục đúng theo dòng Excel gốc.`);
  if (reconciled.extraFromAi > 0) warnings.push(`AI trả thêm ${reconciled.extraFromAi} dòng không khớp STT/dòng Excel hợp lệ; website đã loại khỏi kết quả.`);
  if (!trades.length) warnings.push('AI không tìm thấy lệnh đã hạch toán hợp lệ trong các sheet ngày.');
  return {
    trades,
    monthLabel: monthLabelFromTrades(trades),
    warnings: [...new Set(warnings.filter(Boolean))],
    sourceSheetCount: sheets.length,
  };
}

export async function reviewWeeklyTradesWithAi(
  sourceTrades: TradeRecord[],

): Promise<WeeklyAiReview> {
  if (!sourceTrades.length) throw new Error('Chưa có dữ liệu tổng hợp lệnh để lập báo cáo tuần.');
  const compactRows = sourceTrades.map((trade, rowIndex) => ({
    rowIndex,
    reportDate: trade.reportDate,
    account: trade.account,
    trader: trade.trader,
    contractCode: trade.contractCode,
    commodity: trade.commodity,
    position: trade.position,
    lots: trade.lots,
    pnlAfterFee: trade.pnlAfterFee,
  }));
  const result = await callGeminiJson<{
    rows?: Array<{ rowIndex: number; trader: string; account: string; commodity: string }>;
    notes?: string[];
  }>(

    `Bạn là AI kiểm tra dữ liệu báo cáo tuần LME. Dữ liệu đầu vào bên dưới CHỈ gồm các lệnh đã hạch toán từ bảng Tổng hợp lệnh.

Nhiệm vụ duy nhất:
- Chuẩn hóa cách viết tên người thực hiện, tài khoản và mặt hàng để các dòng cùng đối tượng được cộng chung.
- Không thêm, xóa, nhân bản hoặc thay đổi số liệu, ngày, vị thế, lot hay P&L.
- Giữ nguyên rowIndex cho từng dòng. Mỗi rowIndex đầu vào phải xuất đúng một lần.
- Tài khoản chuẩn: BIDV, Vietinbank, PG SIM, PG BP 668, PG BP 888, STONEX.
- Mặt hàng chuẩn: Nhôm, Đồng, Kẽm khi xác định được; nếu không thì giữ nguyên.
- Ghi cảnh báo ngắn trong notes nếu tên người/tài khoản không rõ.

Website sẽ dùng kết quả chuẩn hóa này và tự đối soát phép cộng theo tuần bằng công thức, không dùng OTE hay dữ liệu vị thế.

DỮ LIỆU TỔNG HỢP:
${JSON.stringify(compactRows)}`,
    WEEKLY_REVIEW_SCHEMA,
    16384,
  );
  const reviewed = new Map((result.rows || []).map((row) => [row.rowIndex, row]));
  const trades = sourceTrades.map((trade, index) => {
    const row = reviewed.get(index);
    if (!row) return trade;
    return {
      ...trade,
      trader: row.trader.trim() || trade.trader,
      account: canonicalAccount(row.account || trade.account),
      commodity: commodityFor(trade.contractCode, row.commodity || trade.commodity),
    };
  });
  const missing = sourceTrades.length - reviewed.size;
  const notes = [...(result.notes || [])];
  if (missing > 0) notes.push(`${missing} dòng không được AI trả lại; website giữ nguyên dữ liệu tổng hợp ban đầu.`);
  return { trades, notes: [...new Set(notes.filter(Boolean))] };
}
