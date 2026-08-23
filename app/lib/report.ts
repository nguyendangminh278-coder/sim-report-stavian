export const ACCOUNT_OPTIONS = [
  { name: 'BIDV', code: 'BIDV', fee: 0.66 },
  { name: 'Vietinbank', code: 'VIETINBANK', fee: 0.616 },
  { name: 'PG SIM', code: 'PG SIM', fee: 0.572 },
  { name: 'PG BP 668', code: 'PG BP 668', fee: 0.572 },
  { name: 'PG BP 888', code: 'PG BP 888', fee: 0.572 },
  { name: 'STONEX', code: 'STONEX', fee: 0.7936 },
] as const;

export type AccountName = (typeof ACCOUNT_OPTIONS)[number]['name'];

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
  plBeforeFee: number | null;
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
      value =
        comma > dot
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
  if (/short|bán|\bs\d*\b|\bb\d*\b/.test(value)) return 'Short';
  if (/long|mua|\bl\d*\b|\bm\d*\b/.test(value)) return 'Long';
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
        id: crypto.randomUUID?.() || `position-${Date.now()}-${index}`,
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
        confidence:
          typeof row.confidence === 'number' ? row.confidence : null,
      };
    })
    .filter((row) => row.code);
}

export function normalizeTrades(rows: AiTrade[] = []): TradeRow[] {
  return rows
    .map((row, index) => {
      const code = (row.contract_code || '').trim().toUpperCase();
      return {
        id: crypto.randomUUID?.() || `trade-${Date.now()}-${index}`,
        executor: (row.executor || '').trim(),
        openDate: (row.open_date || '').trim(),
        closeDate: (row.close_date || '').trim(),
        maturityDate:
          (row.maturity_date || '').trim() || maturityDateFromCode(code),
        code,
        side: normalizeSide(row.position || '', row.open_action || ''),
        openPrice: parseImageNumber(row.open_price),
        closePrice: parseImageNumber(row.close_price),
        lots: parseImageNumber(row.lots),
        carry: parseImageNumber(row.carry),
        plBeforeFee: parseImageNumber(row.pl, 'pnl'),
        confidence:
          typeof row.confidence === 'number' ? row.confidence : null,
      };
    })
    .filter((row) => row.code || row.plBeforeFee !== null);
}

export function calculateTrade(row: TradeRow, fee: number) {
  const lots = row.lots ?? 0;
  const tons = lots * 25;
  const totalFee = tons * fee;
  const afterFee =
    row.plBeforeFee === null ? null : row.plBeforeFee - totalFee;
  return { tons, totalFee, afterFee };
}

export function formatNumber(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '';
  return value.toFixed(digits);
}

export function formatLots(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    screen_type: {
      type: 'STRING',
      enum: ['positions', 'trades', 'no_trades', 'unknown'],
    },
    account_label: { type: 'STRING' },
    positions: {
      type: 'ARRAY',
      items: {
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
        required: [
          'contract_code',
          'maturity',
          'side',
          'entry_price',
          'lots',
          'ote',
          'confidence',
          'source_note',
        ],
      },
    },
    trades: {
      type: 'ARRAY',
      items: {
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
      },
    },
    warnings: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['screen_type', 'account_label', 'positions', 'trades', 'warnings'],
};

export function buildExtractionPrompt(
  accountName: string,
  accountCode: string,
  fee: number,
): string {
  return `Bạn là hệ thống trích xuất dữ liệu từ ảnh chụp màn hình giao dịch LME.

TÀI KHOẢN HIỆN TẠI
- Tên: ${accountName}
- Mã tài khoản: ${accountCode || '(không có)'}
- Phí mặc định để website tính sau: ${fee} USD/MT

MỤC TIÊU
1. Tự nhận diện ảnh là Positions/Trạng thái, Purchase & Sales/Mua & Bán/P&S/M&B, màn hình không có giao dịch, hoặc không xác định.
2. Chỉ lấy dữ liệu nhìn thấy rõ. Không đoán. Thiếu thông tin trả chuỗi rỗng.
3. Trả JSON đúng schema; không viết Markdown hay giải thích ngoài JSON.

QUY TẮC SỐ
- Giữ số nhìn thấy trong ảnh ở dạng chuỗi. Không thêm dấu phân cách hàng nghìn.
- Dấu phẩy thập phân phải đổi thành dấu chấm: 3503,00 → 3503.00.
- Riêng OTE/P&L: -7.511 có nghĩa là -7511.00.
- Nếu OTE/P&L có sẵn, lấy đúng con số trên ảnh; không tự tính lại.
- 1 lot = 25 tấn, nhưng không cần tự tính tấn hay phí. Website sẽ tính theo quy tắc cố định.

POSITIONS / TRẠNG THÁI
- M hoặc L màu xanh = Long. Giá vào là giá mua, khối lượng là KL mua.
- S hoặc B màu đỏ = Short. Giá vào là giá bán, khối lượng là KL bán.
- AHDD hoặc LALZ = Nhôm; LDKZ = Đồng; ZDSD hoặc LZHZ = Kẽm.
- Mã LALZ, LDKZ, LZHZ có maturity là 90d Fwd.
- Mã có month code: F=1, G=2, H=3, J=4, K=5, M=6, N=7, Q=8, U=9, V=10, X=11, Z=12.
- Nếu một mã có nhiều dòng ở mức giá khác nhau, trả riêng từng dòng.

PURCHASE & SALES / MUA & BÁN
- Trả mỗi giao dịch đã tất toán thành một phần tử trades.
- Mua trước bán sau = Long. Bán trước mua sau = Short.
- pl phải là đúng P/L trên ảnh. Không tính lại từ giá mở/đóng.
- Ghép cặp mở/đóng chỉ khi cùng mã và cùng khối lượng; nếu không chắc, giữ trường chưa rõ là rỗng và thêm cảnh báo.
- Không tự điền người thực hiện, ngày mở, ngày đóng, ngày đáo hạn hoặc carry khi ảnh không có.
- Nếu ảnh ghi "No purchases and sales for account" hoặc "Bạn không có mua hay bán", screen_type phải là no_trades.

KIỂM SOÁT CHẤT LƯỢNG
- confidence từ 0 đến 1 cho từng dòng.
- source_note ghi ngắn gọn phần nào mờ/không chắc; nếu rõ thì để rỗng.
- PG BP 668 và PG BP 888 là hai tài khoản riêng; không gộp.
- Nếu ảnh hiển thị tài khoản khác ${accountName}, vẫn trích xuất nhưng phải thêm cảnh báo.`;
}

