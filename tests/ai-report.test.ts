import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSettledTradeFromAi,
  reconcileExtractedTrades,
  serializeDailySheets,
  type AiExtractedTrade,
} from '../app/lib/ai-report.ts';
import ExcelJS from 'exceljs';

const settledLong: AiExtractedTrade = {
  sourceSheet: 'Ngày 20.08',
  sourceRow: '24',
  sourceStt: '1',
  reportDate: '20/08/2026',
  account: 'BIDV',
  trader: 'Đức',
  openDate: '20/08/2026',
  closeDate: '21/08/2026',
  expiryDate: '20/11/2026',
  contractCode: 'LALZ',
  commodity: '',
  position: 'Long',
  openPrice: '3209.00',
  closePrice: '3201.50',
  lots: '1',
  carryPrice: '',
};

test('AI chỉ nhận lệnh đã có ngày tất toán và đủ hai giá', () => {
  assert.equal(normalizeSettledTradeFromAi({ ...settledLong, closeDate: '' }), null);
  assert.equal(normalizeSettledTradeFromAi({ ...settledLong, closePrice: '' }), null);
  assert.equal(normalizeSettledTradeFromAi(settledLong)?.closeDate, '2026-08-21');
});

test('AI không được suy đoán dòng hạch toán khi STT hoặc dòng gốc bị trống', () => {
  assert.equal(normalizeSettledTradeFromAi({ ...settledLong, sourceStt: '' }), null);
  assert.equal(normalizeSettledTradeFromAi({ ...settledLong, sourceRow: '' }), null);
});

test('đối soát phí hai lượt và P&L sau phí từ dữ liệu AI', () => {
  const trade = normalizeSettledTradeFromAi(settledLong);
  assert.ok(trade);
  assert.equal(trade.tonnes, 25);
  assert.equal(trade.feeRate, 0.66);
  assert.equal(trade.totalFee, 33);
  assert.equal(trade.pnlBeforeFee, -187.5);
  assert.equal(trade.pnlAfterFee, -220.5);
  assert.equal(trade.commodity, 'Nhôm');
});

test('đối soát theo dòng gốc giữ đủ hai giao dịch giống nhau khi AI bỏ sót một dòng', () => {
  const first = normalizeSettledTradeFromAi(settledLong);
  const second = normalizeSettledTradeFromAi({ ...settledLong, sourceRow: '25', sourceStt: '2' });
  assert.ok(first && second);
  const reconciled = reconcileExtractedTrades([first, second], [first]);
  assert.equal(reconciled.trades.length, 2);
  assert.equal(reconciled.missingFromAi, 1);
  assert.equal(reconciled.extraFromAi, 0);
  assert.equal(reconciled.trades.reduce((sum, trade) => sum + (trade.pnlAfterFee ?? 0), 0), -441);
});

test('chuẩn hóa mã tài khoản PG BP trong workbook mẫu', () => {
  assert.equal(normalizeSettledTradeFromAi({ ...settledLong, account: 'PG BP 8668' })?.account, 'PG BP 668');
  assert.equal(normalizeSettledTradeFromAi({ ...settledLong, account: 'PB BP 8888' })?.account, 'PG BP 888');
});

test('bỏ qua ô gộp rỗng và chỉ tuần tự hóa block hạch toán', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Ngày 20.08');
  sheet.mergeCells('A1:Q1');
  sheet.getCell('A1').value = 'Vị thế đang có: PG BP 8668';
  sheet.mergeCells('A3:Q3');
  sheet.getCell('A3').value = 'HẠCH TOÁN LỢI NHUẬN GIAO DỊCH';
  sheet.addRow([
    'STT', 'Người thực hiện', 'Ngày mở lệnh', 'Ngày tất toán', 'Ngày đáo hạn',
    'Mã hợp đồng', 'Mặt hàng', 'Vị thế', 'Giá mở', 'Giá đóng',
  ]);
  sheet.addRow([1, 'Đức', '20/08/2026', '21/08/2026', '20/11/2026', 'LALZ', 'Nhôm', 'Long', 3209, 3201.5]);
  sheet.mergeCells('A8:Q8');

  const buffer = await workbook.xlsx.writeBuffer();
  const serialized = await serializeDailySheets(buffer as ArrayBuffer);
  assert.equal(serialized.length, 1);
  assert.equal(serialized[0].blocks.length, 1);
  assert.equal(serialized[0].blocks[0].accountHint, 'PG BP 668');
  assert.equal(serialized[0].blocks[0].rows.at(-1)?.row, 5);
});
