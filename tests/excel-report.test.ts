import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { buildWorkweekBuckets, parseSimWorkbook } from '../app/lib/excel-report.ts';

const HEADERS = [
  'Ngày báo cáo', 'Ngân hàng', 'Tài khoản', 'Sheet gốc', 'Dòng gốc', 'STT gốc',
  'Người thực hiện', 'Ngày mở lệnh', 'Ngày tất toán', 'Ngày đáo hạn', 'Mã hợp đồng',
  'Mặt hàng', 'Vị thế', 'Giá mở', 'Giá đóng', 'Khối lượng quy đổi (lot)',
  'Khối lượng quy đổi (tấn)', 'Phí giao dịch (usd/mt)', 'Tổng phí/lệnh',
  'Giá carry (usd/mt)', 'Lợi nhuận chưa phí giao dịch',
  'Lợi nhuận sau phí giao dịch',
];

async function fixtureWorkbook(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet('Tổng hợp lệnh tháng 8');
  summary.addRow(HEADERS);
  summary.addRow([
    new Date(2026, 7, 20), 'BIDV', 'BIDV', 'Ngày 20.08', 24, 1, 'Đức',
    new Date(2026, 7, 20), new Date(2026, 7, 21), new Date(2026, 10, 20),
    'LALZ', 'Nhôm', 'Long', 3209, 3201.5, 1, 25, 0.66,
    { formula: 'Q2*R2*2', result: 33 }, '',
    { formula: 'IF(M2="Long",(O2-N2)*Q2,(N2-O2)*Q2)', result: -187.5 },
    { formula: 'U2-S2', result: -220.5 },
  ]);

  const weekly = workbook.addWorksheet('Báo Cáo Tuần - Tháng 8');
  weekly.getCell('A3').value = 'Tổng hợp lãi/lỗ sau phí theo người thực hiện';
  weekly.getRow(4).values = [undefined, 'Người thực hiện', '03.08 - 07.08',
    '10.08 - 14.08', '17.08 - 21.08', '24.08 - 28.08', '31.08',
    'Tổng', 'KPI còn thiếu', 'NOTE'];
  weekly.getRow(5).values = [undefined, 'Đức', 0, 0, -220.5, 0, 0, -220.5,
    -100220.5, 'Ghi chú thử'];
  weekly.getRow(14).values = [undefined, 'Thành viên', 'Tài khoản phụ trách OTE',
    'P&L sau phí tháng 8 (USD)', 'OTE ngày 11/08 (USD)', 'Tổng gồm OTE (USD)',
    'Số lệnh quy đổi (lot)', 'Winrate tháng', 'Tiền cấp (USD)',
    'Rủi ro tối đa tháng (USD)', 'Số lệnh lỗ quy đổi',
    'Cắt lỗ TB/lệnh lỗ (USD)', '% cắt lỗ TB/lệnh lỗ'];
  weekly.getRow(15).values = [undefined, 'Đức', 'VIETINBANK', -220.5, -239732.5,
    -239953, 1, 0, 100000, 7500, 1, 220.5, 0.002205];

  return await workbook.xlsx.writeBuffer() as ArrayBuffer;
}

test('đọc đúng bảng 22 cột và kết quả cached của ô công thức', async () => {
  const parsed = await parseSimWorkbook(await fixtureWorkbook());
  assert.equal(parsed.sourceMode, 'summary-sheet');
  assert.equal(parsed.trades.length, 1);
  const trade = parsed.trades[0];
  assert.equal(trade.reportDate, '2026-08-20');
  assert.equal(trade.contractCode, 'LALZ');
  assert.equal(trade.totalFee, 33);
  assert.equal(trade.pnlBeforeFee, -187.5);
  assert.equal(trade.pnlAfterFee, -220.5);
});

test('file tháng 7 chỉ lấy STT hợp lệ, giữ dòng trùng và gán đúng năm báo cáo', async () => {
  const workbook = new ExcelJS.Workbook();
  const headers = [
    'STT', 'Người thực hiện', 'Ngày mở lệnh', 'Ngày tất toán', 'Ngày đáo hạn',
    'Mã hợp đồng', 'Mặt hàng', 'Vị thế', 'Giá mở', 'Giá đóng',
    'Khối lượng quy đổi (lot)', 'Khối lượng quy đổi (tấn)', 'Phí giao dịch (usd/mt)',
    'Tổng phí/lệnh', 'Giá carry (usd/mt)', 'Lợi nhuận chưa phí giao dịch',
    'Lợi nhuận sau phí giao dịch',
  ];
  const addDay = (name: string, rows: unknown[][]) => {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(['HẠCH TOÁN LỢI NHUẬN GIAO DỊCH - PG BP 8668']);
    sheet.addRow(headers);
    rows.forEach((row) => sheet.addRow(row));
  };
  const row = (stt: number | string, day: number, open: number, close: number, pnl: number) => [
    stt, 'C Phương', new Date(2026, 6, day), new Date(2026, 6, day),
    new Date(2026, 6, 10), 'LALZ', 'Nhôm', 'Long', open, close, 1, 25,
    0.572, 28.6, '', (close - open) * 25, pnl,
  ];
  addDay('Ngày 07.07', [row(1, 7, 3148, 3149, -3.6), row(2, 7, 3148, 3149, -3.6)]);
  addDay('Ngày 08.07', [row('', 8, 3130, 3129.5, -41.1), row(1, 8, 3151.5, 3151, -41.1), row(2, 8, 3151.5, 3151, -41.1)]);
  addDay('Ngày 10.07', [row('', 10, 3613, 3615, 21.4)]);
  addDay('Ngày 13.07', [[
    1, 'Đức', '13/07', '13/07', new Date(2026, 9, 10), 'LALZ', 'Nhôm',
    'Long', 3200, 3200, 1, 25, 0.572, 28.6, '', 0, -28.6,
  ]]);

  const buffer = await workbook.xlsx.writeBuffer();
  const parsed = await parseSimWorkbook(buffer as ArrayBuffer);
  assert.equal(parsed.sourceMode, 'daily-sheets');
  assert.equal(parsed.trades.length, 5);
  assert.deepEqual(parsed.trades.map((trade) => trade.reportDate), [
    '2026-07-07', '2026-07-07', '2026-07-08', '2026-07-08', '2026-07-13',
  ]);
  const week = buildWorkweekBuckets(parsed.trades).find((bucket) => bucket.label === '06.07 - 10.07');
  assert.ok(week);
  assert.equal(week.trades.length, 4);
  assert.equal(week.trades.reduce((sum, trade) => sum + (trade.pnlAfterFee ?? 0), 0), -89.4);
});

test('giữ OTE, KPI, NOTE và dữ liệu tháng từ sheet báo cáo tuần', async () => {
  const parsed = await parseSimWorkbook(await fixtureWorkbook());
  const reference = parsed.weeklyReference.traders.find((entry) => entry.trader === 'Đức');
  assert.ok(reference);
  assert.equal(reference.accountResponsibility, 'VIETINBANK');
  assert.equal(reference.ote, -239732.5);
  assert.equal(reference.funding, 100000);
  assert.equal(reference.maxRisk, 7500);
  assert.equal(reference.kpiRemaining, -100220.5);
  assert.equal(reference.note, 'Ghi chú thử');
  assert.equal(reference.inMonthlySummary, true);
  assert.equal(reference.periodValues?.['17.08 - 21.08'], -220.5);
});
