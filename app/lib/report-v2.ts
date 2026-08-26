export const ACCOUNT_OPTIONS = [
  { name: 'BIDV', code: 'BIDV', fee: 0.66 },
  { name: 'Vietinbank', code: 'VIETINBANK', fee: 0.616 },
  { name: 'PG SIM', code: 'PG SIM', fee: 0.572 },
  { name: 'PG BP 668', code: 'PG BP 668', fee: 0.572 },
  { name: 'PG BP 888', code: 'PG BP 888', fee: 0.572 },
  { name: 'STONEX', code: 'STONEX', fee: 0.7936 },
] as const;

export type ImageType = 'auto' | 'positions' | 'trades';

export type AiSign = 'negative' | 'positive' | 'zero' | 'unknown' | string;

export type AiPosition = {
  contract_code?: string;
  maturity?: string;
  side?: string;
  entry_price?: string;
  lots?: string;
  ote?: string;
  ote_sign?: AiSign;
  confidence?: number;
  source_note?: string;
};

export type AiTrade = {
  executor?: string;
  open_date?: string;
  close_date?: string;
  maturity_date?: string;
  contract_code?: string;
  position?: string;
  open_action?: string;
  open_price?: string;
  close_price?: string;
  lots?: string;
  carry?: string;
  pl?: string;
  pl_sign?: AiSign;
  confidence?: number;
  source_note?: string;
};

export type AiTradeLine = {
  group_id?: string;
  row_index?: number;
  contract_code?: string;
  trade_date?: string;
  action?: string;
  lots?: string;
  price?: string;
  pl?: string;
  pl_sign?: AiSign;
  confidence?: number;
  source_note?: string;
};

export type AiResult = {
  screen_type?: 'positions' | 'trades' | 'no_trades' | 'unknown';
  account_label?: string;
  positions?: AiPosition[];
  trades?: AiTrade[];
  trade_lines?: AiTradeLine[];
  visible_position_count?: number;
  visible_trade_line_count?: number;
  visible_trade_pair_count?: number;
  visible_ote_total?: string;
  warnings?: string[];
};

export type PositionRow = {
  id: string;
  product: string;
  maturity: string;
  code: string;
  buyPrice: number | null;
  buyLots: number | null;
  sellPrice: number | null;
  sellLots: number | null;
  ote: number | null;
  note: string;
  confidence: number | null;
};

export type TradeRow = {
  id: string;
  executor: string;
  openDate: string;
  closeDate: string;
  maturityDate: string;
  code: string;
  side: 'Long' | 'Short' | '';
  openPrice: number | null;
  closePrice: number | null;
  lots: number | null;
  carry: number | null;
  reportedPl: number | null;
  confidence: number | null;
};

export type AccountReport = {
  id: string;
  accountName: string;
  accountCode: string;
  fee: number;
  positions: PositionRow[];
  trades: TradeRow[];
  noTrades: boolean;
  warnings: string[];
  sourceFiles: string[];
};

const MONTH_CODES: Record<string, number> = {
  F: 1,
  G: 2,
  H: 3,
  J: 4,
  K: 5,
  M: 6,
  N: 7,
  Q: 8,
  U: 9,
  V: 10,
  X: 11,
  Z: 12,
};

const FORWARD_CODES = new Set(['LALZ', 'LDKZ', 'LZHZ']);

function uid(prefix: string, index: number) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${index}`;
}

function normalizedFileStem(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' & ')
    .replace(/[^a-z0-9&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferImageType(fileName: string): ImageType {
  const stem = normalizedFileStem(fileName);
  const tokens = new Set(stem.split(' ').filter(Boolean));
  const isTrades =
    tokens.has('ps') ||
    /\bp\s*&\s*s\b/.test(stem) ||
    /\bm\s*&\s*b\b/.test(stem) ||
    tokens.has('purchase') ||
    tokens.has('sales') ||
    stem.includes('mua ban') ||
    stem.includes('hach toan');
  if (isTrades) return 'trades';

  const isPositions =
    tokens.has('po') ||
    tokens.has('position') ||
    tokens.has('positions') ||
    stem.includes('vi the') ||
    stem.includes('trang thai');
  return isPositions ? 'positions' : 'auto';
}

export function imageTypeLabel(type: ImageType) {
  if (type === 'positions') return 'PO · Vị thế';
  if (type === 'trades') return 'PS · Hạch toán';
  return 'Tự nhận diện';
}

export function productFromCode(code: string): string {
  const value = code.trim().toUpperCase();
  if (value.startsWith('AHDD') || value.startsWith('LALZ')) return 'Nhôm';
  if (value.startsWith('LDKZ')) return 'Đồng';
  if (value.startsWith('ZDSD') || value.startsWith('LZHZ')) return 'Kẽm';
  return '';
}

export function maturityFromCode(code: string): string {
  const value = code.trim().toUpperCase();
  if (FORWARD_CODES.has(value)) return '90d Fwd';
  const match = value.match(/(?:\d{1,2})?([FGHJKMNQUVXZ])(\d{2})$/);
  if (!match) return '';
  const month = MONTH_CODES[match[1]];
  return month ? `Tháng ${String(month).padStart(2, '0')}/${2000 + Number(match[2])}` : '';
}

export function maturityDateFromCode(code: string): string {
  const value = code.trim().toUpperCase();
  if (FORWARD_CODES.has(value)) return '';
  const match = value.match(/(\d{1,2})([FGHJKMNQUVXZ])(\d{2})$/);
  if (!match) return '';
  const month = MONTH_CODES[match[2]];
  if (!month) return '';
  return `${match[1].padStart(2, '0')}/${String(month).padStart(2, '0')}/${2000 + Number(match[3])}`;
}

export function parseImageNumber(
  input: unknown,
  context: 'regular' | 'pnl' = 'regular',
): number | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;

  let value = String(input)
    .trim()
    .replace(/\s+/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/[$€£₫]/g, '');
  if (!value || /^n\/?a$/i.test(value) || value === '-') return null;

  if (context === 'pnl' && /^-?\d{1,3}\.\d{3}$/.test(value)) {
    value = value.replace('.', '');
  } else {
    const comma = value.lastIndexOf(',');
    const dot = value.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      value = comma > dot
        ? value.replace(/\./g, '').replace(',', '.')
        : value.replace(/,/g, '');
    } else if (comma >= 0) {
      const decimals = value.length - comma - 1;
      value = decimals <= 2 ? value.replace(',', '.') : value.replace(/,/g, '');
    }
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function applyExplicitSign(
  input: unknown,
  sign: AiSign = 'unknown',
  context: 'regular' | 'pnl' = 'regular',
): number | null {
  const parsed = parseImageNumber(input, context);
  if (parsed === null) return null;
  const normalizedSign = String(sign || 'unknown').trim().toLowerCase();
  if (/negative|minus|âm|^-$/.test(normalizedSign)) return -Math.abs(parsed);
  if (/positive|plus|dương|^\+$/.test(normalizedSign)) return Math.abs(parsed);
  if (/zero|^0$/.test(normalizedSign)) return 0;
  return parsed;
}

function validDateParts(day: number, month: number, year: number) {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function normalizeDateVN(input: unknown, sourceOrder: 'auto' | 'MDY' | 'DMY' = 'auto'): string {
  const value = String(input ?? '').trim();
  if (!value) return '';
  const iso = value.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (iso) {
    const [, yearText, monthText, dayText] = iso;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    return validDateParts(day, month, year)
      ? String(day).padStart(2, '0') + '/' + String(month).padStart(2, '0') + '/' + year
      : '';
  }
  const match = value.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/);
  if (!match) return value;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const mdy = sourceOrder === 'MDY' || (sourceOrder === 'auto' && second > 12 && first <= 12);
  const day = mdy ? second : first;
  const month = mdy ? first : second;
  return validDateParts(day, month, year)
    ? String(day).padStart(2, '0') + '/' + String(month).padStart(2, '0') + '/' + year
    : value;
}

export function addThreeMonthsVN(input: unknown): string {
  const normalized = normalizeDateVN(input);
  const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return '';
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const targetIndex = year * 12 + (month - 1) + 3;
  const targetYear = Math.floor(targetIndex / 12);
  const targetMonth = targetIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return String(Math.min(day, lastDay)).padStart(2, '0') + '/' + String(targetMonth + 1).padStart(2, '0') + '/' + targetYear;
}

export function normalizeSide(side: string, action = ''): 'Long' | 'Short' | '' {
  const value = `${side} ${action}`.trim().toLowerCase();
  if (!value) return '';
  if (/short|sell|bán|\bs\d*\b|\bb\d*\b/.test(value)) return 'Short';
  if (/long|buy|mua|\bl\d*\b|\bm\d*\b/.test(value)) return 'Long';
  return '';
}

export function normalizePositions(rows: AiPosition[] = []): PositionRow[] {
  return rows
    .map((row, index) => {
      const code = (row.contract_code || '').trim().toUpperCase();
      const side = normalizeSide(row.side || '');
      const price = parseImageNumber(row.entry_price);
      const lots = parseImageNumber(row.lots);
      const deterministicMaturity = maturityFromCode(code);
      return {
        id: uid('position', index),
        product: productFromCode(code),
        maturity: deterministicMaturity || (row.maturity || '').trim(),
        code,
        buyPrice: side === 'Long' ? price : null,
        buyLots: side === 'Long' ? lots : null,
        sellPrice: side === 'Short' ? price : null,
        sellLots: side === 'Short' ? lots : null,
        ote: applyExplicitSign(row.ote, row.ote_sign, 'pnl'),
        note: side || (row.source_note || '').trim(),
        confidence: typeof row.confidence === 'number' ? row.confidence : null,
      };
    })
    .filter((row) => row.code);
}

function lineLots(input: unknown): number | null {
  return parseImageNumber(String(input ?? '').replace(/[LSMB]$/i, ''));
}

function lineDateValue(input: unknown) {
  const normalized = normalizeDateVN(input, 'MDY');
  const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? Number(match[3] + match[2] + match[1]) : null;
}

function candidatePnl(openLine: AiTradeLine, closeLine: AiTradeLine, lots: number | null) {
  const side = normalizeSide('', openLine.action || '');
  const openPrice = parseImageNumber(openLine.price);
  const closePrice = parseImageNumber(closeLine.price);
  if (!side || openPrice === null || closePrice === null || lots === null) return null;
  const tonnes = lots * 25;
  return side === 'Long' ? (closePrice - openPrice) * tonnes : (openPrice - closePrice) * tonnes;
}

export function pairTradeLines(lines: AiTradeLine[] = []): AiTrade[] {
  const groups = new Map<string, AiTradeLine[]>();
  for (const [index, line] of lines.entries()) {
    const code = (line.contract_code || '').trim().toUpperCase();
    if (!code) continue;
    const key = (line.group_id || code).trim() || code;
    const bucket = groups.get(key) || [];
    bucket.push({ ...line, contract_code: code, row_index: line.row_index ?? index + 1 });
    groups.set(key, bucket);
  }

  const paired: AiTrade[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => (a.row_index ?? 0) - (b.row_index ?? 0));
    for (let index = 0; index + 1 < group.length; index += 2) {
      const first = group[index];
      const second = group[index + 1];
      const firstSide = normalizeSide('', first.action || '');
      const secondSide = normalizeSide('', second.action || '');
      if (!firstSide || !secondSide || firstSide === secondSide) continue;
      const firstLots = lineLots(first.lots);
      const secondLots = lineLots(second.lots);
      const lots = firstLots ?? secondLots;
      if (firstLots !== null && secondLots !== null && Math.abs(firstLots - secondLots) > 1e-9) continue;

      const firstDate = lineDateValue(first.trade_date);
      const secondDate = lineDateValue(second.trade_date);
      let openLine = second;
      let closeLine = first;
      if (firstDate !== null && secondDate !== null && firstDate !== secondDate) {
        [openLine, closeLine] = firstDate < secondDate ? [first, second] : [second, first];
      } else {
        const reported = applyExplicitSign(first.pl, first.pl_sign, 'pnl')
          ?? applyExplicitSign(second.pl, second.pl_sign, 'pnl');
        if (reported !== null) {
          const firstCandidate = candidatePnl(first, second, lots);
          const secondCandidate = candidatePnl(second, first, lots);
          if (
            firstCandidate !== null &&
            (secondCandidate === null || Math.abs(firstCandidate - reported) < Math.abs(secondCandidate - reported))
          ) {
            openLine = first;
            closeLine = second;
          }
        }
      }

      const reportedPl = applyExplicitSign(first.pl, first.pl_sign, 'pnl')
        ?? applyExplicitSign(second.pl, second.pl_sign, 'pnl');
      paired.push({
        executor: '',
        open_date: normalizeDateVN(openLine.trade_date, 'MDY'),
        close_date: normalizeDateVN(closeLine.trade_date, 'MDY'),
        maturity_date: '',
        contract_code: openLine.contract_code || closeLine.contract_code || '',
        position: normalizeSide('', openLine.action || ''),
        open_action: openLine.action || '',
        open_price: openLine.price || '',
        close_price: closeLine.price || '',
        lots: lots === null ? '' : String(lots),
        carry: '',
        pl: reportedPl === null ? '' : String(reportedPl),
        pl_sign: reportedPl === null ? 'unknown' : reportedPl < 0 ? 'negative' : reportedPl > 0 ? 'positive' : 'zero',
        confidence: Math.min(openLine.confidence ?? 1, closeLine.confidence ?? 1),
        source_note: [openLine.source_note, closeLine.source_note].filter(Boolean).join(' | '),
      });
    }
  }
  return paired;
}

export function normalizeTrades(rows: AiTrade[] = [], tradeLines: AiTradeLine[] = []): TradeRow[] {
  const pairedRows = pairTradeLines(tradeLines);
  const sourceRows = pairedRows.length ? pairedRows : rows;
  return sourceRows
    .map((row, index) => {
      const code = (row.contract_code || '').trim().toUpperCase();
      const openDate = normalizeDateVN(row.open_date);
      const closeDate = normalizeDateVN(row.close_date);
      return {
        id: uid('trade', index),
        executor: (row.executor || '').trim(),
        openDate,
        closeDate,
        maturityDate: addThreeMonthsVN(openDate) || normalizeDateVN(row.maturity_date) || maturityDateFromCode(code),
        code,
        side: normalizeSide(row.position || '', row.open_action || ''),
        openPrice: parseImageNumber(row.open_price),
        closePrice: parseImageNumber(row.close_price),
        lots: parseImageNumber(row.lots),
        carry: parseImageNumber(row.carry),
        reportedPl: applyExplicitSign(row.pl, row.pl_sign, 'pnl'),
        confidence: typeof row.confidence === 'number' ? row.confidence : null,
      };
    })
    .filter((row) => row.code || row.reportedPl !== null);
}

export function calculateTrade(row: TradeRow, fee: number) {
  const tons = row.lots === null ? null : row.lots * 25;
  const totalFee = tons === null ? null : tons * fee * 2;
  const beforeFee =
    tons === null || row.openPrice === null || row.closePrice === null || !row.side
      ? null
      : row.side === 'Long'
        ? (row.closePrice - row.openPrice) * tons
        : (row.openPrice - row.closePrice) * tons;
  const afterFee = beforeFee === null || totalFee === null ? null : beforeFee - totalFee;
  return { tons, totalFee, beforeFee, afterFee };
}

export function weightedPositionSummary(rows: PositionRow[]) {
  const buyLots = rows.reduce((sum, row) => sum + (row.buyLots ?? 0), 0);
  const sellLots = rows.reduce((sum, row) => sum + (row.sellLots ?? 0), 0);
  const buyValue = rows.reduce(
    (sum, row) => sum + (row.buyPrice ?? 0) * (row.buyLots ?? 0),
    0,
  );
  const sellValue = rows.reduce(
    (sum, row) => sum + (row.sellPrice ?? 0) * (row.sellLots ?? 0),
    0,
  );
  return {
    buyLots,
    sellLots,
    averageBuy: buyLots ? buyValue / buyLots : null,
    averageSell: sellLots ? sellValue / sellLots : null,
    ote: rows.reduce((sum, row) => sum + (row.ote ?? 0), 0),
  };
}

export function formatNumber(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '';
  return value.toFixed(digits);
}

export function formatLots(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function selectAiData(result: AiResult, expectedType: ImageType) {
  const rawPositions = result.positions || [];
  const rawTrades = result.trades || [];
  const rawTradeLines = result.trade_lines || [];
  const warnings = [...(result.warnings || [])];
  let resolvedType: ImageType = expectedType;

  if (expectedType === 'auto') {
    if (result.screen_type === 'positions') resolvedType = 'positions';
    else if (result.screen_type === 'trades' || result.screen_type === 'no_trades') resolvedType = 'trades';
    else if (rawPositions.length && !rawTrades.length) resolvedType = 'positions';
    else if ((rawTrades.length || rawTradeLines.length) && !rawPositions.length) resolvedType = 'trades';
  }

  const aiType = result.screen_type;
  if (
    expectedType !== 'auto' &&
    aiType &&
    aiType !== 'unknown' &&
    !(expectedType === 'trades' && aiType === 'no_trades') &&
    aiType !== expectedType
  ) {
    warnings.push(
      `AI nhận diện ${aiType}, nhưng hệ thống giữ loại ${imageTypeLabel(expectedType)} theo tên file/lựa chọn của bạn.`,
    );
  }

  if (resolvedType === 'positions' && rawTrades.length) {
    warnings.push(`Đã chặn ${rawTrades.length} dòng hạch toán vì ảnh được khóa là PO · Vị thế.`);
  }
  if (resolvedType === 'trades' && rawPositions.length) {
    warnings.push(`Đã chặn ${rawPositions.length} dòng vị thế vì ảnh được khóa là PS · Hạch toán.`);
  }
  if (resolvedType === 'auto' && rawPositions.length && rawTrades.length) {
    warnings.push('Ảnh chưa xác định rõ PO hay PS. Hãy chọn loại ảnh rồi đọc lại để tránh gộp sai bảng.');
  }

  return {
    resolvedType,
    positions: resolvedType === 'positions' ? rawPositions : [],
    trades: resolvedType === 'trades' ? rawTrades : [],
    tradeLines: resolvedType === 'trades' ? rawTradeLines : [],
    visiblePositionCount: result.visible_position_count,
    visibleTradeLineCount: result.visible_trade_line_count,
    visibleTradePairCount: result.visible_trade_pair_count,
    visibleOteTotal: result.visible_ote_total,
    noTrades: resolvedType === 'trades' && result.screen_type === 'no_trades',
    warnings,
  };
}

const POSITION_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    contract_code: { type: 'STRING' },
    maturity: { type: 'STRING' },
    side: { type: 'STRING' },
    entry_price: { type: 'STRING' },
    lots: { type: 'STRING' },
    ote: { type: 'STRING' },
    ote_sign: { type: 'STRING', enum: ['negative', 'positive', 'zero', 'unknown'] },
    confidence: { type: 'NUMBER' },
    source_note: { type: 'STRING' },
  },
  required: ['contract_code', 'maturity', 'side', 'entry_price', 'lots', 'ote', 'ote_sign', 'confidence', 'source_note'],
};

const TRADE_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    executor: { type: 'STRING' },
    open_date: { type: 'STRING' },
    close_date: { type: 'STRING' },
    maturity_date: { type: 'STRING' },
    contract_code: { type: 'STRING' },
    position: { type: 'STRING' },
    open_action: { type: 'STRING' },
    open_price: { type: 'STRING' },
    close_price: { type: 'STRING' },
    lots: { type: 'STRING' },
    carry: { type: 'STRING' },
    pl: { type: 'STRING' },
    pl_sign: { type: 'STRING', enum: ['negative', 'positive', 'zero', 'unknown'] },
    confidence: { type: 'NUMBER' },
    source_note: { type: 'STRING' },
  },
  required: [
    'executor',
    'open_date',
    'close_date',
    'maturity_date',
    'contract_code',
    'position',
    'open_action',
    'open_price',
    'close_price',
    'lots',
    'carry',
    'pl',
    'pl_sign',
    'confidence',
    'source_note',
  ],
};

const TRADE_LINE_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    group_id: { type: 'STRING' },
    row_index: { type: 'NUMBER' },
    contract_code: { type: 'STRING' },
    trade_date: { type: 'STRING' },
    action: { type: 'STRING' },
    lots: { type: 'STRING' },
    price: { type: 'STRING' },
    pl: { type: 'STRING' },
    pl_sign: { type: 'STRING', enum: ['negative', 'positive', 'zero', 'unknown'] },
    confidence: { type: 'NUMBER' },
    source_note: { type: 'STRING' },
  },
  required: ['group_id', 'row_index', 'contract_code', 'trade_date', 'action', 'lots', 'price', 'pl', 'pl_sign', 'confidence', 'source_note'],
};

export function createGeminiResponseSchema(expectedType: ImageType) {
  const screenTypes =
    expectedType === 'positions'
      ? ['positions']
      : expectedType === 'trades'
        ? ['trades', 'no_trades']
        : ['positions', 'trades', 'no_trades', 'unknown'];
  return {
    type: 'OBJECT',
    properties: {
      screen_type: { type: 'STRING', enum: screenTypes },
      account_label: { type: 'STRING' },
      positions: { type: 'ARRAY', items: POSITION_ITEM_SCHEMA },
      trades: { type: 'ARRAY', items: TRADE_ITEM_SCHEMA },
      trade_lines: { type: 'ARRAY', items: TRADE_LINE_ITEM_SCHEMA },
      visible_position_count: { type: 'NUMBER' },
      visible_trade_line_count: { type: 'NUMBER' },
      visible_trade_pair_count: { type: 'NUMBER' },
      visible_ote_total: { type: 'STRING' },
      warnings: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: [
      'screen_type', 'account_label', 'positions', 'trades', 'trade_lines',
      'visible_position_count', 'visible_trade_line_count', 'visible_trade_pair_count',
      'visible_ote_total', 'warnings',
    ],
  };
}

export function buildExtractionPrompt(
  accountName: string,
  accountCode: string,
  fee: number,
  fileName: string,
  expectedType: ImageType,
): string {
  const hardConstraint =
    expectedType === 'positions'
      ? 'BẮT BUỘC coi đây là ảnh PO/POSITIONS. screen_type=positions, chỉ điền positions và trades phải là [].'
      : expectedType === 'trades'
        ? 'BẮT BUỘC coi đây là ảnh PS/PURCHASE & SALES. screen_type=trades (hoặc no_trades nếu ảnh nói không có giao dịch), chỉ điền trades và positions phải là [].'
        : 'Tên file không đủ rõ. Hãy phân loại bằng THÂN BẢNG theo dấu hiệu bên dưới, không dựa vào tiêu đề chung.';

  return `Bạn là hệ thống trích xuất dữ liệu từ ảnh chụp màn hình giao dịch LME.

TÀI KHOẢN VÀ FILE
- Tên tài khoản: ${accountName}
- Mã tài khoản: ${accountCode || '(không có)'}
- Phí mặc định để website tính sau: ${fee} USD/MT
- Tên file: ${fileName}
- Loại ảnh đã chọn: ${imageTypeLabel(expectedType)}

RÀNG BUỘC PHÂN LOẠI QUAN TRỌNG NHẤT
${hardConstraint}
- Dòng tiêu đề lớn “Positions” ở đầu màn hình xuất hiện trên CẢ PO và PS. PHẢI BỎ QUA tiêu đề này khi phân loại.
- PO/POSITIONS có các nhãn Avg, OTE và nút Liquidate / Reverse / Close / Go flat; mỗi khối là một vị thế mở.
- PS/PURCHASE & SALES có các cột Date, Size, Price, P/L và nhiều dòng L/S dưới cùng mã; thường không có các nút đóng vị thế.
- Tab đang sáng và cấu trúc thân bảng quan trọng hơn tiêu đề trên cùng.

NGUYÊN TẮC CHUNG
- Chỉ lấy dữ liệu nhìn thấy rõ. Không đoán. Thiếu thông tin trả chuỗi rỗng.
- Trả JSON đúng schema; không viết Markdown hoặc giải thích ngoài JSON.
- Giữ số nhìn thấy trong ảnh ở dạng chuỗi, đổi dấu phẩy thập phân thành dấu chấm.
- Với MỌI OTE/P&L, phải đọc dấu riêng vào ote_sign/pl_sign: negative, positive, zero hoặc unknown. Không được bỏ dấu âm.
- Riêng OTE/P&L: -7.511 có nghĩa là -7511.00. 1 lot = 25 tấn.

PO / POSITIONS
- M hoặc L màu xanh = Long: entry_price là Giá mua, lots là KL mua.
- S hoặc B màu đỏ = Short: entry_price là Giá bán, lots là KL bán.
- AHDD hoặc LALZ = Nhôm; LDKZ = Đồng; ZDSD hoặc LZHZ = Kẽm.
- LALZ, LDKZ, LZHZ có maturity 90d Fwd.
- Month code: F=1, G=2, H=3, J=4, K=5, M=6, N=7, Q=8, U=9, V=10, X=11, Z=12.
- Nếu một mã có nhiều vị thế ở mức giá khác nhau, trả riêng từng dòng.
- Đếm toàn bộ khối vị thế nhìn thấy trước, ghi visible_position_count, rồi trích đúng từng khối. Không gộp hai mức giá.
- maturity của mã tháng phải đúng dạng “Tháng xx/yyyy”, ví dụ AHDD17X26 → “Tháng 11/2026”.
- Lấy đúng OTE trên ảnh, không tính lại; ghi tổng OTE nhìn thấy vào visible_ote_total.

PS / PURCHASE & SALES
- BƯỚC 1: Đếm tất cả dòng Date/Size/Price/P&L nhìn thấy, kể cả dòng P/L=n/a; ghi visible_trade_line_count.
- BƯỚC 2: Chép TỪNG DÒNG theo thứ tự từ trên xuống vào trade_lines. row_index tăng liên tục; group_id giống nhau cho các dòng nằm trong cùng một khối mã. trade_date phải chép đúng M/D/YY như ảnh, action chỉ là L/S/M/B và lots chỉ là số.
- Không được bỏ dòng trùng nhau. Hai cặp giống hệt nhau vẫn phải trả đủ bốn trade_lines.
- BƯỚC 3: Đếm số cặp đã tất toán vào visible_trade_pair_count. Website sẽ tự ghép trade_lines; trades chỉ là kết quả đối chiếu dự phòng.
- Mỗi cặp L/S đã tất toán là MỘT phần tử trades. Không biến từng dòng L/S thành vị thế mở.
- Ghép các dòng cùng mã và cùng khối lượng. Nếu có nhiều cặp, ghép các dòng liền kề hợp lý và giữ mỗi cặp thành một giao dịch riêng.
- Hành động xảy ra trước là mở lệnh; hành động xảy ra sau là tất toán. Bán trước mua sau = Short; mua trước bán sau = Long.
- Nếu hai hành động cùng ngày, dùng thứ tự cặp trong ảnh và giá trị P/L để kiểm tra chiều Long/Short.
- Ví dụ dòng 1S ngày 17/08 rồi 1L ngày 19/08: Short, giá mở là giá S, giá đóng là giá L.
- Ví dụ 4S giá 3205 ngày 19/08 rồi 4L giá 3200 ngày 20/08: một lệnh Short 4 lot.
- Trong trade_lines, giữ ngày nguồn M/D/YY. Trong trades, xuất DD/MM/YYYY, ví dụ 8/19/26 → 19/08/2026.
- Ngày đáo hạn không cần đoán từ mã: website luôn tính đúng 3 tháng sau ngày mở lệnh.
- pl chỉ chép P/L nhìn thấy để đối soát. Website sẽ tính lợi nhuận chính thức từ giá mở/đóng và tấn.
- Không tự điền người thực hiện hoặc carry khi ảnh không có.
- Nếu ảnh ghi “No purchases and sales for account” hoặc “Bạn không có mua hay bán”, screen_type=no_trades.

KIỂM SOÁT CHẤT LƯỢNG
- confidence từ 0 đến 1 cho từng dòng.
- source_note ghi phần mờ/không chắc; nếu rõ thì để rỗng.
- PG BP 668 và PG BP 888 luôn là hai tài khoản riêng.
- Nếu ảnh hiển thị tài khoản khác ${accountName}, vẫn trích xuất nhưng thêm cảnh báo.`;
}


export function auditAiResult(result: AiResult, expectedType: ImageType): string[] {
  const issues: string[] = [];
  if (expectedType === 'positions') {
    const rows = result.positions || [];
    if (!rows.length) issues.push('Không có dòng vị thế dù ảnh được khóa là PO.');
    if (typeof result.visible_position_count === 'number' && result.visible_position_count !== rows.length) {
      issues.push('Đếm thấy ' + result.visible_position_count + ' vị thế nhưng chỉ trả ' + rows.length + ' dòng.');
    }
    if (rows.some((row) => !row.ote_sign || row.ote_sign === 'unknown')) issues.push('Có OTE chưa xác nhận dấu âm/dương.');
  }
  if (expectedType === 'trades' && result.screen_type !== 'no_trades') {
    const lines = result.trade_lines || [];
    const pairs = pairTradeLines(lines);
    if (!lines.length) issues.push('Chưa chép từng dòng Date/Size/Price/P&L của ảnh PS.');
    if (typeof result.visible_trade_line_count === 'number' && result.visible_trade_line_count !== lines.length) {
      issues.push('Đếm thấy ' + result.visible_trade_line_count + ' dòng PS nhưng chỉ trả ' + lines.length + ' dòng.');
    }
    if (lines.length % 2 !== 0) issues.push('Số dòng PS là số lẻ; có thể đã thiếu một vế L/S.');
    if (typeof result.visible_trade_pair_count === 'number' && result.visible_trade_pair_count !== pairs.length) {
      issues.push('Đếm thấy ' + result.visible_trade_pair_count + ' cặp nhưng website chỉ ghép được ' + pairs.length + ' cặp.');
    }
    if (lines.some((line) => line.pl && line.pl.toLowerCase() !== 'n/a' && (!line.pl_sign || line.pl_sign === 'unknown'))) {
      issues.push('Có P/L chưa xác nhận dấu âm/dương.');
    }
  }
  return issues;
}

export function extractionQualityScore(result: AiResult, expectedType: ImageType): number {
  const issues = auditAiResult(result, expectedType);
  const rowCount = expectedType === 'positions'
    ? (result.positions || []).length
    : pairTradeLines(result.trade_lines || []).length || (result.trades || []).length;
  const confidenceValues = expectedType === 'positions'
    ? (result.positions || []).map((row) => row.confidence)
    : (result.trade_lines || []).map((row) => row.confidence);
  const confidence = confidenceValues.filter((value): value is number => typeof value === 'number');
  return rowCount * 10 + (confidence.length ? confidence.reduce((sum, value) => sum + value, 0) / confidence.length : 0) - issues.length * 50;
}

export function buildExtractionAuditPrompt(basePrompt: string, issues: string[], firstResult: AiResult): string {
  return basePrompt + '\n\nKIỂM TRA LẦN HAI BẮT BUỘC\nKết quả đầu có lỗi:\n- '
    + issues.join('\n- ')
    + '\nHãy đếm lại trực tiếp trên ảnh từ đầu, đặc biệt giữ mọi dòng trùng và dấu âm. Không sao chép mù kết quả cũ.\nKết quả lần đầu để đối chiếu:\n'
    + JSON.stringify(firstResult);
}
