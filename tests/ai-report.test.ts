import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSettledTradeFromAi,
  type AiExtractedTrade,
} from '../app/lib/ai-report.ts';

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
