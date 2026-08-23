import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateTrade,
  maturityFromCode,
  normalizePositions,
  parseImageNumber,
  productFromCode,
  type TradeRow,
} from '../app/lib/report.ts';

test('chuẩn hóa dấu thập phân và P/L dạng hàng nghìn', () => {
  assert.equal(parseImageNumber('3503,00'), 3503);
  assert.equal(parseImageNumber('-7.511', 'pnl'), -7511);
  assert.equal(parseImageNumber('13,535.50'), 13535.5);
});

test('ánh xạ mặt hàng và tháng đáo hạn', () => {
  assert.equal(productFromCode('AHDD11U26'), 'Nhôm');
  assert.equal(productFromCode('LDKZ'), 'Đồng');
  assert.equal(productFromCode('ZDSD30V26'), 'Kẽm');
  assert.equal(maturityFromCode('LALZ'), '90d Fwd');
  assert.equal(maturityFromCode('AHDD11U26'), 'Tháng 9/2026');
});

test('vị thế L/M là Long và giữ nguyên OTE trên ảnh', () => {
  const rows = normalizePositions([
    {
      contract_code: 'LALZ',
      maturity: '',
      side: 'L',
      entry_price: '3400,00',
      lots: '2',
      ote: '-7.511',
      confidence: 0.98,
    },
  ]);
  assert.equal(rows[0].buyPrice, 3400);
  assert.equal(rows[0].buyLots, 2);
  assert.equal(rows[0].sellPrice, null);
  assert.equal(rows[0].ote, -7511);
  assert.equal(rows[0].maturity, '90d Fwd');
});

test('tổng phí theo prompt mới: lot × 25 × phí, không nhân đôi', () => {
  const row: TradeRow = {
    id: 't1',
    executor: '',
    openDate: '',
    closeDate: '',
    maturityDate: '',
    code: 'LALZ',
    side: 'Long',
    openPrice: 3400,
    closePrice: 3405,
    lots: 2,
    carry: null,
    plBeforeFee: 250,
    confidence: 1,
  };
  const result = calculateTrade(row, 0.572);
  assert.equal(result.tons, 50);
  assert.ok(Math.abs(result.totalFee - 28.6) < 1e-9);
  assert.notEqual(result.afterFee, null);
  if (result.afterFee !== null) {
    assert.ok(Math.abs(result.afterFee - 221.4) < 1e-9);
  }
});
