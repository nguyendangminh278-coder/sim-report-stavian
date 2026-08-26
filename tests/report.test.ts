import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addThreeMonthsVN,
  auditAiResult,
  buildExtractionPrompt,
  calculateTrade,
  inferImageType,
  maturityFromCode,
  normalizeDateVN,
  normalizePositions,
  normalizeTrades,
  pairTradeLines,
  parseImageNumber,
  productFromCode,
  selectAiData,
  weightedPositionSummary,
  type AiResult,
} from '../app/lib/report-v2.ts';

test('khóa loại ảnh theo token PO và PS trong tên file', () => {
  assert.equal(inferImageType('PO BIDV.jpg'), 'positions');
  assert.equal(inferImageType('PS BIDV.jpg'), 'trades');
  assert.equal(inferImageType('Purchase & Sales - STONEX.png'), 'trades');
  assert.equal(inferImageType('M&B PG BP 668.webp'), 'trades');
  assert.equal(inferImageType('IMG_1234.jpg'), 'auto');
});

test('không cho dữ liệu PS chảy sang bảng PO hoặc ngược lại', () => {
  const mixed: AiResult = {
    screen_type: 'positions',
    positions: [{ contract_code: 'AHDD12X26' }],
    trades: [{ contract_code: 'LALZ' }],
  };
  const ps = selectAiData(mixed, 'trades');
  assert.equal(ps.positions.length, 0);
  assert.equal(ps.trades.length, 1);
  const po = selectAiData(mixed, 'positions');
  assert.equal(po.positions.length, 1);
  assert.equal(po.trades.length, 0);
});

test('chuẩn hóa số, mặt hàng và tháng đáo hạn', () => {
  assert.equal(parseImageNumber('3503,00'), 3503);
  assert.equal(parseImageNumber('-7.511', 'pnl'), -7511);
  assert.equal(productFromCode('AHDD17X26'), 'Nhôm');
  assert.equal(productFromCode('LDKZ'), 'Đồng');
  assert.equal(productFromCode('ZDSD30V26'), 'Kẽm');
  assert.equal(maturityFromCode('LALZ'), '90d Fwd');
  assert.equal(maturityFromCode('AHDD17X26'), 'Tháng 11/2026');
  assert.equal(maturityFromCode('AHDD22U26'), 'Tháng 09/2026');
});

test('fixture PO BIDV tạo 2 vị thế Short và đúng tổng OTE', () => {
  const positions = normalizePositions([
    { contract_code: 'AHDD12X26', side: 'S1', entry_price: '3327.00', lots: '1', ote: '3025.00' },
    { contract_code: 'AHDD17X26', side: 'S1', entry_price: '3266.00', lots: '1', ote: '1465.75' },
  ]);
  assert.equal(positions.length, 2);
  assert.deepEqual(positions.map((row) => row.note), ['Short', 'Short']);
  assert.equal(positions.reduce((sum, row) => sum + (row.ote ?? 0), 0), 4490.75);
  const summary = weightedPositionSummary(positions);
  assert.equal(summary.sellLots, 2);
  assert.equal(summary.averageSell, 3296.5);
});

test('công thức hạch toán mới nhân phí hai lượt và tính PL từ giá', () => {
  const [row] = normalizeTrades([{ contract_code: 'LALZ', position: 'Long', open_price: '3209.00', close_price: '3201.50', lots: '1' }]);
  const result = calculateTrade(row, 0.616);
  assert.equal(result.tons, 25);
  assert.ok(result.totalFee !== null && Math.abs(result.totalFee - 30.8) < 1e-9);
  assert.ok(result.beforeFee !== null && Math.abs(result.beforeFee - -187.5) < 1e-9);
  assert.ok(result.afterFee !== null && Math.abs(result.afterFee - -218.3) < 1e-9);
});

test('fixture PS BIDV giữ đủ 5 giao dịch, kể cả hai dòng giống nhau', () => {
  const trades = normalizeTrades([
    { contract_code: 'AHDD17X26', position: 'Short', open_price: '3263.00', close_price: '3208.00', lots: '1', pl: '1375.00' },
    { contract_code: 'AHDD17X26', position: 'Short', open_price: '3263.00', close_price: '3208.00', lots: '1', pl: '1375.00' },
    { contract_code: 'AHDD19X26', position: 'Long', open_price: '3205.50', close_price: '3224.50', lots: '1', pl: '475.00' },
    { contract_code: 'AHDD19X26', position: 'Long', open_price: '3205.50', close_price: '3234.00', lots: '1', pl: '712.50' },
    { contract_code: 'LALZ', position: 'Short', open_price: '3205.00', close_price: '3200.00', lots: '4', pl: '500.00' },
  ]);
  assert.equal(trades.length, 5);
  const totals = trades.reduce((sum, row) => {
    const calc = calculateTrade(row, 0.66);
    sum.lots += row.lots ?? 0;
    sum.fee += calc.totalFee ?? 0;
    sum.before += calc.beforeFee ?? 0;
    sum.after += calc.afterFee ?? 0;
    return sum;
  }, { lots: 0, fee: 0, before: 0, after: 0 });
  assert.equal(totals.lots, 8);
  assert.ok(Math.abs(totals.fee - 264) < 1e-9);
  assert.ok(Math.abs(totals.before - 4437.5) < 1e-9);
  assert.ok(Math.abs(totals.after - 4173.5) < 1e-9);
});

test('prompt PS bỏ qua tiêu đề Positions và dùng dấu hiệu Price/P/L', () => {
  const prompt = buildExtractionPrompt('BIDV', '584', 0.66, 'PS BIDV.jpg', 'trades');
  assert.match(prompt, /PHẢI BỎ QUA tiêu đề này/);
  assert.match(prompt, /Date, Size, Price, P\/L/);
  assert.match(prompt, /positions phải là \[\]/);
  assert.match(prompt, /4S giá 3205/);
});


test('chuẩn hóa ngày và luôn tính đáo hạn đúng ba tháng sau ngày mở lệnh', () => {
  assert.equal(normalizeDateVN('8/19/26', 'MDY'), '19/08/2026');
  assert.equal(normalizeDateVN('20/08/2026'), '20/08/2026');
  assert.equal(addThreeMonthsVN('20/08/2026'), '20/11/2026');
  assert.equal(addThreeMonthsVN('31/01/2026'), '30/04/2026');
  const [trade] = normalizeTrades([{ open_date: '20/08/2026', close_date: '21/08/2026', maturity_date: '01/01/2000', contract_code: 'LALZ', position: 'Long', open_price: '3209', close_price: '3201.5', lots: '1' }]);
  assert.equal(trade.maturityDate, '20/11/2026');
});

test('mã tháng luôn thắng chuỗi maturity AI và dấu OTE được khóa riêng', () => {
  const [row] = normalizePositions([{ contract_code: 'AHDD17X26', maturity: '11/2026', side: 'S', entry_price: '3266', lots: '1', ote: '1465.75', ote_sign: 'negative' }]);
  assert.equal(row.maturity, 'Tháng 11/2026');
  assert.equal(row.ote, -1465.75);
});

test('ghép dòng PS thô giữ đủ hai cặp giống nhau và đúng thứ tự thời gian', () => {
  const lines = [
    { group_id: 'AHDD17-1', row_index: 1, contract_code: 'AHDD17X26', trade_date: '8/19/26', action: 'L', lots: '1', price: '3208.00', pl: 'n/a', pl_sign: 'unknown' },
    { group_id: 'AHDD17-1', row_index: 2, contract_code: 'AHDD17X26', trade_date: '8/17/26', action: 'S', lots: '1', price: '3263.00', pl: '1375.00', pl_sign: 'positive' },
    { group_id: 'AHDD17-1', row_index: 3, contract_code: 'AHDD17X26', trade_date: '8/19/26', action: 'L', lots: '1', price: '3208.00', pl: 'n/a', pl_sign: 'unknown' },
    { group_id: 'AHDD17-1', row_index: 4, contract_code: 'AHDD17X26', trade_date: '8/17/26', action: 'S', lots: '1', price: '3263.00', pl: '1375.00', pl_sign: 'positive' },
  ];
  const paired = pairTradeLines(lines);
  assert.equal(paired.length, 2);
  const trades = normalizeTrades([], lines);
  assert.deepEqual(trades.map((row) => [row.side, row.openDate, row.closeDate, row.openPrice, row.closePrice, row.reportedPl]), [
    ['Short', '17/08/2026', '19/08/2026', 3263, 3208, 1375],
    ['Short', '17/08/2026', '19/08/2026', 3263, 3208, 1375],
  ]);
});

test('bộ kiểm tra phát hiện thiếu dòng PS và dấu P/L chưa xác nhận', () => {
  const issues = auditAiResult({
    screen_type: 'trades',
    visible_trade_line_count: 4,
    visible_trade_pair_count: 2,
    trade_lines: [
      { group_id: 'x', row_index: 1, contract_code: 'LALZ', trade_date: '8/20/26', action: 'L', lots: '1', price: '3200', pl: '-25', pl_sign: 'unknown' },
      { group_id: 'x', row_index: 2, contract_code: 'LALZ', trade_date: '8/19/26', action: 'S', lots: '1', price: '3201', pl: 'n/a', pl_sign: 'unknown' },
    ],
  }, 'trades');
  assert.ok(issues.some((issue) => issue.includes('4 dòng PS')));
  assert.ok(issues.some((issue) => issue.includes('P/L')));
});
