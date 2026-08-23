export const ACCOUNT_OPTIONS = [
  { name: 'BIDV', code: 'BIDV', fee: 0.66 },
  { name: 'Vietinbank', code: 'VIETINBANK', fee: 0.616 },
  { name: 'PG SIM', code: 'PG SIM', fee: 0.572 },
  { name: 'PG BP 668', code: 'PG BP 668', fee: 0.572 },
  { name: 'PG BP 888', code: 'PG BP 888', fee: 0.572 },
  { name: 'STONEX', code: 'STONEX', fee: 0.7936 },
] as const;

export type ImageType = 'auto' | 'positions' | 'trades';

export type AiPosition = {
  contract_code?: string;
  maturity?: string;
  side?: string;
  entry_price?: string;
  lots?: string;
  ote?: string;
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
  confidence?: number;
  source_note?: string;
};

export type AiResult = {
  screen_type?: 'positions' | 'trades' | 'no_trades' | 'unknown';
  account_label?: string;
  positions?: AiPosition[];
  trades?: AiTrade[];
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
  return month ? `Tháng ${month}/${2000 + Number(match[2])}` : '';
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
      return {
        id: uid('position', index),
        product: productFromCode(code),
        maturity: FORWARD_CODES.has(code)
          ? '90d Fwd'
          : (row.maturity || '').trim() || maturityFromCode(code),
        code,
        buyPrice: side === 'Long' ? price : null,
        buyLots: side === 'Long' ? lots : null,
        sellPrice: side === 'Short' ? price : null,
        sellLots: side === 'Short' ? lots : null,
        ote: parseImageNumber(row.ote, 'pnl'),
        note: side || (row.source_note || '').trim(),
        confidence: typeof row.confidence === 'number' ? row.confidence : null,
      };
    })
    .filter((row) => row.code);
}

export function normalizeTrades(rows: AiTrade[] = []): TradeRow[] {
  return rows
    .map((row, index) => {
      const code = (row.contract_code || '').trim().toUpperCase();
      return {
        id: uid('trade', index),
        executor: (row.executor || '').trim(),
        openDate: (row.open_date || '').trim(),
        closeDate: (row.close_date || '').trim(),
        maturityDate: (row.maturity_date || '').trim() || maturityDateFromCode(code),
        code,
        side: normalizeSide(row.position || '', row.open_action || ''),
        openPrice: parseImageNumber(row.open_price),
        closePrice: parseImageNumber(row.close_price),
        lots: parseImageNumber(row.lots),
        carry: parseImageNumber(row.carry),
        reportedPl: parseImageNumber(row.pl, 'pnl'),
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
  const warnings = [...(result.warnings || [])];
  let resolvedType: ImageType = expectedType;

  if (expectedType === 'auto') {
    if (result.screen_type === 'positions') resolvedType = 'positions';
    else if (result.screen_type === 'trades' || result.screen_type === 'no_trades') resolvedType = 'trades';
    else if (rawPositions.length && !rawTrades.length) resolvedType = 'positions';
    else if (rawTrades.length && !rawPositions.length) resolvedType = 'trades';
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
    confidence: { type: 'NUMBER' },
    source_note: { type: 'STRING' },
  },
  required: ['contract_code', 'maturity', 'side', 'entry_price', 'lots', 'ote', 'confidence', 'source_note'],
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
    'confidence',
    'source_note',
  ],
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
      warnings: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['screen_type', 'account_label', 'positions', 'trades', 'warnings'],
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
- Riêng OTE/P&L: -7.511 có nghĩa là -7511.00. 1 lot = 25 tấn.

PO / POSITIONS
- M hoặc L màu xanh = Long: entry_price là Giá mua, lots là KL mua.
- S hoặc B màu đỏ = Short: entry_price là Giá bán, lots là KL bán.
- AHDD hoặc LALZ = Nhôm; LDKZ = Đồng; ZDSD hoặc LZHZ = Kẽm.
- LALZ, LDKZ, LZHZ có maturity 90d Fwd.
- Month code: F=1, G=2, H=3, J=4, K=5, M=6, N=7, Q=8, U=9, V=10, X=11, Z=12.
- Nếu một mã có nhiều vị thế ở mức giá khác nhau, trả riêng từng dòng.
- Lấy đúng OTE trên ảnh, không tính lại.

PS / PURCHASE & SALES
- Mỗi cặp L/S đã tất toán là MỘT phần tử trades. Không biến từng dòng L/S thành vị thế mở.
- Ghép các dòng cùng mã và cùng khối lượng. Nếu có nhiều cặp, ghép các dòng liền kề hợp lý và giữ mỗi cặp thành một giao dịch riêng.
- Hành động xảy ra trước là mở lệnh; hành động xảy ra sau là tất toán. Bán trước mua sau = Short; mua trước bán sau = Long.
- Nếu hai hành động cùng ngày, dùng thứ tự cặp trong ảnh và giá trị P/L để kiểm tra chiều Long/Short.
- Ví dụ dòng 1S ngày 17/08 rồi 1L ngày 19/08: Short, giá mở là giá S, giá đóng là giá L.
- Ví dụ 4S giá 3205 ngày 19/08 rồi 4L giá 3200 ngày 20/08: một lệnh Short 4 lot.
- Ngày trên màn hình LME dạng M/D/YY phải xuất ra DD/MM/YYYY khi rõ, ví dụ 8/19/26 → 19/08/2026.
- pl chỉ chép P/L nhìn thấy để đối soát. Website sẽ tính lợi nhuận chính thức từ giá mở/đóng và tấn.
- Không tự điền người thực hiện hoặc carry khi ảnh không có.
- Nếu ảnh ghi “No purchases and sales for account” hoặc “Bạn không có mua hay bán”, screen_type=no_trades.

KIỂM SOÁT CHẤT LƯỢNG
- confidence từ 0 đến 1 cho từng dòng.
- source_note ghi phần mờ/không chắc; nếu rõ thì để rỗng.
- PG BP 668 và PG BP 888 luôn là hai tài khoản riêng.
- Nếu ảnh hiển thị tài khoản khác ${accountName}, vẫn trích xuất nhưng thêm cảnh báo.`;
}
