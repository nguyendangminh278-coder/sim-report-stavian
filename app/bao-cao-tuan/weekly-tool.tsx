'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { buildWorkweekBuckets, type TradeRecord } from '../lib/excel-report';
import { reviewWeeklyTradesWithAi } from '../lib/ai-report';
import './weekly-report.css';
import './ai-weekly.css';

type Period = {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
};

type Summary = {
  name: string;
  accounts: string;
  periodPnl: number[];
  pnl: number;
  lots: number;
  winningLots: number;
  losingLots: number;
  lossValue: number;
  winrate: number | null;
  averageLoss: number | null;
};

function numberValue(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalized(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
}

function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDecimal(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function valueClass(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'wr-cell-neutral';
  if (value > 0) return 'wr-cell-positive';
  if (value < 0) return 'wr-cell-negative';
  return 'wr-cell-zero';
}

function inPeriod(date: string, period: Period) {
  return Boolean(date && date >= period.startDate && date <= period.endDate);
}

function summariesBy(
  trades: TradeRecord[],
  periods: Period[],
  labelFor: (trade: TradeRecord) => string,
  accountsFor?: (trade: TradeRecord) => string,
): Summary[] {
  const groups = new Map<string, { name: string; trades: TradeRecord[] }>();
  for (const trade of trades) {
    const name = labelFor(trade).trim() || 'Chưa xác định';
    const key = normalized(name);
    const current = groups.get(key) || { name, trades: [] };
    current.trades.push(trade);
    groups.set(key, current);
  }
  return [...groups.values()]
    .map(({ name, trades: rows }) => {
      const pnl = rows.reduce((sum, row) => sum + numberValue(row.pnlAfterFee), 0);
      const lots = rows.reduce((sum, row) => sum + numberValue(row.lots), 0);
      const winningLots = rows
        .filter((row) => numberValue(row.pnlAfterFee) > 0)
        .reduce((sum, row) => sum + numberValue(row.lots), 0);
      const losingRows = rows.filter((row) => numberValue(row.pnlAfterFee) < 0);
      const losingLots = losingRows.reduce((sum, row) => sum + numberValue(row.lots), 0);
      const lossValue = Math.abs(losingRows.reduce((sum, row) => sum + numberValue(row.pnlAfterFee), 0));
      const accounts = [...new Set(rows.map((row) => accountsFor?.(row) || '').filter(Boolean))].join(' + ');
      return {
        name,
        accounts,
        periodPnl: periods.map((period) => rows
          .filter((row) => inPeriod(row.reportDate, period))
          .reduce((sum, row) => sum + numberValue(row.pnlAfterFee), 0)),
        pnl,
        lots,
        winningLots,
        losingLots,
        lossValue,
        winrate: lots > 0 ? winningLots / lots : null,
        averageLoss: losingLots > 0 ? lossValue / losingLots : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

function totalSummary(trades: TradeRecord[], periods: Period[]): Summary {
  return summariesBy(trades, periods, () => 'TỔNG')[0] || {
    name: 'TỔNG', accounts: '', periodPnl: periods.map(() => 0), pnl: 0, lots: 0,
    winningLots: 0, losingLots: 0, lossValue: 0, winrate: null, averageLoss: null,
  };
}

function safeFileName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

export default function WeeklyReportPage({

  trades,
  monthLabel,
  onOpenMonthly,
}: {

  trades: TradeRecord[];
  monthLabel: string;
  onOpenMonthly: () => void;
}) {
  const [reviewedTrades, setReviewedTrades] = useState<TradeRecord[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  const periods = useMemo<Period[]>(() => reviewedTrades
    ? buildWorkweekBuckets(reviewedTrades).map(({ key, label, startDate, endDate }) => ({ key, label, startDate, endDate }))
    : [], [reviewedTrades]);
  const traderSummaries = useMemo(() => reviewedTrades
    ? summariesBy(reviewedTrades, periods, (row) => row.trader, (row) => row.account)
    : [], [periods, reviewedTrades]);
  const accountSummaries = useMemo(() => reviewedTrades
    ? summariesBy(reviewedTrades, periods, (row) => row.account)
    : [], [periods, reviewedTrades]);
  const commoditySummaries = useMemo(() => reviewedTrades
    ? summariesBy(reviewedTrades, periods, (row) => row.commodity)
    : [], [periods, reviewedTrades]);
  const total = useMemo(() => totalSummary(reviewedTrades || [], periods), [periods, reviewedTrades]);

  async function generateReport() {
    if (!trades.length) return;
    setIsLoading(true);
    setError('');
    try {
      const result = await reviewWeeklyTradesWithAi(trades);
      setReviewedTrades(result.trades);
      setNotes(result.notes);
    } catch (cause) {
      setReviewedTrades(null);
      setNotes([]);
      setError(cause instanceof Error ? cause.message : 'Không thể tạo báo cáo tuần bằng AI.');
    } finally {
      setIsLoading(false);
    }
  }

  function buildTsv() {
    const rows: Array<Array<string | number>> = [
      ['TỔNG HỢP LÃI/LỖ SAU PHÍ THEO NGƯỜI THỰC HIỆN'],
      ['Người thực hiện', ...periods.map((period) => period.label), 'Tổng', 'Số lot', 'Winrate'],
      ...traderSummaries.map((row) => [row.name, ...row.periodPnl, row.pnl, row.lots, row.winrate ?? '']),
      ['TỔNG', ...total.periodPnl, total.pnl, total.lots, total.winrate ?? ''],
      [],
      ['TỔNG KẾT LỆNH ĐÃ HẠCH TOÁN'],
      ['Thành viên', 'Tài khoản', 'P&L sau phí', 'Số lot', 'Lot thắng', 'Winrate', 'Lot lỗ', 'Cắt lỗ TB/lot lỗ'],
      ...traderSummaries.map((row) => [
        row.name, row.accounts, row.pnl, row.lots, row.winningLots, row.winrate ?? '', row.losingLots, row.averageLoss ?? '',
      ]),
      ['TỔNG', 'Toàn phòng', total.pnl, total.lots, total.winningLots, total.winrate ?? '', total.losingLots, total.averageLoss ?? ''],
    ];
    return rows.map((row) => row.map((value) => String(value).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
  }

  async function copyReport() {
    try {
      await writeClipboard(buildTsv());
      setCopyState('done');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('error');
    }
  }

  async function exportExcel() {
    if (!reviewedTrades?.length) return;
    setIsExporting(true);
    setError('');
    try {
      const imported = await import('exceljs');
      const ExcelJS = (imported.default || imported) as typeof import('exceljs');
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'SIM Report — Stavian';
      const sheet = workbook.addWorksheet(`Báo Cáo Tuần - ${monthLabel || 'Tháng'}`.slice(0, 31), {
        views: [{ state: 'frozen', ySplit: 2, xSplit: 1 }],
      });
      const green = 'FF08765B';
      const darkGreen = 'FF064C3C';
      const header = ['Người thực hiện', ...periods.map((period) => period.label), 'Tổng', 'Số lot', 'Winrate'];
      sheet.mergeCells(1, 1, 1, header.length);
      sheet.getCell(1, 1).value = 'Tổng hợp lãi/lỗ sau phí theo người thực hiện';
      sheet.addRow(header);
      traderSummaries.forEach((row) => sheet.addRow([row.name, ...row.periodPnl, row.pnl, row.lots, row.winrate]));
      sheet.addRow(['TỔNG', ...total.periodPnl, total.pnl, total.lots, total.winrate]);
      sheet.addRow([]);
      const summaryStart = sheet.rowCount + 1;
      sheet.mergeCells(summaryStart, 1, summaryStart, 8);
      sheet.getCell(summaryStart, 1).value = 'TỔNG KẾT LỆNH ĐÃ HẠCH TOÁN';
      sheet.addRow(['Thành viên', 'Tài khoản', 'P&L sau phí', 'Số lot', 'Lot thắng', 'Winrate', 'Lot lỗ', 'Cắt lỗ TB/lot lỗ']);
      traderSummaries.forEach((row) => sheet.addRow([
        row.name, row.accounts, row.pnl, row.lots, row.winningLots, row.winrate, row.losingLots, row.averageLoss,
      ]));
      sheet.addRow(['TỔNG', 'Toàn phòng', total.pnl, total.lots, total.winningLots, total.winrate, total.losingLots, total.averageLoss]);
      [1, summaryStart].forEach((rowNumber) => {
        const row = sheet.getRow(rowNumber);
        row.height = 24;
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: darkGreen } };
          cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });
      });
      [2, summaryStart + 1].forEach((rowNumber) => {
        const row = sheet.getRow(rowNumber);
        row.height = 38;
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: green } };
          cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        });
      });
      sheet.columns = Array.from({ length: Math.max(header.length, 8) }, (_, index) => ({ width: index === 0 ? 21 : index === 1 ? 24 : 16 }));
      sheet.eachRow((row, rowNumber) => {
        row.eachCell((cell, columnNumber) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFB7C9C2' } },
            left: { style: 'thin', color: { argb: 'FFB7C9C2' } },
            bottom: { style: 'thin', color: { argb: 'FFB7C9C2' } },
            right: { style: 'thin', color: { argb: 'FFB7C9C2' } },
          };
          if (rowNumber > 2 && columnNumber > 1) cell.numFmt = '#,##0.00;[Red]-#,##0.00';
        });
      });
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeFileName(`Báo cáo tuần ${monthLabel}`) || 'Bao-cao-tuan'}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      console.error(cause);
      setError('Không thể tạo file Excel báo cáo tuần.');
    } finally {
      setIsExporting(false);
    }
  }

  const hasReport = Boolean(reviewedTrades?.length);

  return (
    <main className="wr-page">
      <header className="wr-topbar">
        <Link className="wr-brand" href="/">
          <span className="wr-brand-mark">SIM</span>
          <span><strong>SIM Report</strong><small>Phòng Phái sinh Stavian</small></span>
        </Link>
        <nav className="wr-nav" aria-label="Các công cụ báo cáo">
          <Link href="/">Đọc ảnh</Link>
          <Link href="/tong-hop-lenh">Tổng hợp lệnh</Link>
          <Link className="is-active" href="/bao-cao-tuan" aria-current="page">Báo cáo tuần</Link>
        </nav>
      </header>

      <section className="wr-hero">
        <div>
          <span className="wr-eyebrow">BƯỚC 2 · BÁO CÁO QUẢN TRỊ</span>
          <h1>Báo cáo tuần từ lệnh đã hạch toán</h1>
          <p>
            Báo cáo này chỉ dùng dữ liệu vừa tạo ở phần Tổng hợp lệnh. AI đã chọn chuẩn hóa tên người,
            tài khoản và mặt hàng; website đối soát lại P&amp;L, lot và winrate bằng công thức.
          </p>
        </div>
        <div className="wr-privacy"><span aria-hidden="true">●</span>Không dùng Positions hoặc OTE</div>
      </section>

      <section className="wr-workspace" aria-label="Tạo báo cáo tuần">
        <div className="wr-dropzone wr-sequence-card">
          <div className="wr-upload-icon" aria-hidden="true">2</div>
          <div className="wr-upload-copy">
            <strong>
              {trades.length
                ? `Đã nhận ${trades.length.toLocaleString('vi-VN')} lệnh đã hạch toán`
                : 'Chưa có dữ liệu Tổng hợp lệnh'}
            </strong>
            <span>
              {trades.length
                ? `${monthLabel || 'Chưa xác định tháng'} · sẵn sàng gửi AI kiểm tra trước khi cộng tuần`
                : 'Hãy hoàn tất bước Tổng hợp lệnh trước; trang này không nhận Excel riêng.'}
            </span>
          </div>
          {trades.length ? (
            <button type="button" onClick={() => void generateReport()} disabled={isLoading}>
              {isLoading ? 'AI đang chuẩn hóa…' : hasReport ? 'Tạo lại báo cáo AI' : 'Tạo báo cáo tuần bằng AI'}
            </button>
          ) : (
            <button type="button" onClick={onOpenMonthly}>Mở Tổng hợp lệnh</button>
          )}
        </div>
        {error ? <div className="wr-alert wr-alert-error" role="alert">{error}</div> : null}
        {notes.length ? (
          <details className="wr-alert wr-alert-warning">
            <summary>{notes.length} lưu ý từ AI</summary>
            <ul>{notes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}</ul>
          </details>
        ) : null}
      </section>

      {hasReport ? (
        <section className="wr-report" aria-live="polite">
          <div className="wr-report-toolbar">
            <div><span className="wr-eyebrow">KẾT QUẢ TỪ TỔNG HỢP LỆNH</span><h2>{`Báo cáo ${monthLabel || 'tuần'}`}</h2></div>
            <div className="wr-actions">
              <button className="wr-button-secondary" type="button" onClick={() => void copyReport()}>
                {copyState === 'done' ? 'Đã sao chép' : copyState === 'error' ? 'Không thể sao chép' : 'Sao chép bảng'}
              </button>
              <button className="wr-button-primary" type="button" onClick={() => void exportExcel()} disabled={isExporting}>
                {isExporting ? 'Đang tạo file…' : 'Tải Excel'}
              </button>
            </div>
          </div>

          <div className="wr-sheet-card">
            <div className="wr-sheet-scroll">
              <table className="wr-table wr-weekly-table">
                <caption>Tổng hợp lãi/lỗ sau phí theo người thực hiện</caption>
                <thead>
                  <tr className="wr-super-header"><th colSpan={periods.length + 4}>Tổng hợp lãi/lỗ sau phí theo người thực hiện</th></tr>
                  <tr>
                    <th>Người thực hiện</th>
                    {periods.map((period) => <th key={period.key}>{period.label}</th>)}
                    <th>Tổng</th><th>Số lot</th><th>Winrate</th>
                  </tr>
                </thead>
                <tbody>
                  {traderSummaries.map((row) => (
                    <tr key={row.name}>
                      <th scope="row">{row.name}</th>
                      {row.periodPnl.map((value, index) => <td className={valueClass(value)} key={`${row.name}-${periods[index]?.key}`}>{formatUsd(value)}</td>)}
                      <td className={valueClass(row.pnl)}>{formatUsd(row.pnl)}</td>
                      <td>{formatDecimal(row.lots)}</td>
                      <td className="wr-cell-rate">{formatPercent(row.winrate)}</td>
                    </tr>
                  ))}
                  <tr className="wr-total-row">
                    <th scope="row">TỔNG</th>
                    {total.periodPnl.map((value, index) => <td className={valueClass(value)} key={`total-${periods[index]?.key}`}>{formatUsd(value)}</td>)}
                    <td className={valueClass(total.pnl)}>{formatUsd(total.pnl)}</td>
                    <td>{formatDecimal(total.lots)}</td>
                    <td>{formatPercent(total.winrate)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="wr-sheet-card wr-monthly-card">
            <div className="wr-sheet-scroll">
              <table className="wr-table wr-monthly-table wr-settled-summary">
                <caption>Tổng kết lệnh đã hạch toán</caption>
                <thead>
                  <tr className="wr-super-header"><th colSpan={8}>TỔNG KẾT LỆNH ĐÃ HẠCH TOÁN</th></tr>
                  <tr><th>Thành viên</th><th>Tài khoản</th><th>P&amp;L sau phí</th><th>Số lot</th><th>Lot thắng</th><th>Winrate</th><th>Lot lỗ</th><th>Cắt lỗ TB/lot lỗ</th></tr>
                </thead>
                <tbody>
                  {traderSummaries.map((row) => (
                    <tr key={`summary-${row.name}`}>
                      <th scope="row">{row.name}</th><td className="wr-text-cell">{row.accounts || '—'}</td>
                      <td className={valueClass(row.pnl)}>{formatUsd(row.pnl)}</td><td>{formatDecimal(row.lots)}</td>
                      <td>{formatDecimal(row.winningLots)}</td><td className="wr-cell-rate">{formatPercent(row.winrate)}</td>
                      <td className={row.losingLots ? 'wr-cell-loss-count' : ''}>{formatDecimal(row.losingLots)}</td><td>{formatUsd(row.averageLoss)}</td>
                    </tr>
                  ))}
                  <tr className="wr-total-row wr-grand-total">
                    <th scope="row">TỔNG</th><td>Toàn phòng</td><td className={valueClass(total.pnl)}>{formatUsd(total.pnl)}</td>
                    <td>{formatDecimal(total.lots)}</td><td>{formatDecimal(total.winningLots)}</td><td>{formatPercent(total.winrate)}</td>
                    <td>{formatDecimal(total.losingLots)}</td><td>{formatUsd(total.averageLoss)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="wr-kpi-band wr-settled-kpis">
              <div className={total.pnl >= 0 ? 'wr-kpi-positive' : 'wr-kpi-negative'}><span>TỔNG P&amp;L SAU PHÍ</span><strong>{formatUsd(total.pnl)}</strong></div>
              <div className="wr-kpi-positive"><span>SỐ LỆNH QUY ĐỔI</span><strong>{formatDecimal(total.lots)} lot</strong></div>
              <div className="wr-kpi-positive"><span>WINRATE CHUNG</span><strong>{formatPercent(total.winrate)}</strong></div>
              <div className="wr-kpi-negative"><span>CẮT LỖ TB/LOT LỖ</span><strong>{formatUsd(total.averageLoss)}</strong></div>
            </div>
          </div>

          <div className="wr-breakdown-grid">
            {[
              { title: 'Theo tài khoản', rows: accountSummaries },
              { title: 'Theo mặt hàng', rows: commoditySummaries },
            ].map((group) => (
              <div className="wr-sheet-card" key={group.title}>
                <div className="wr-sheet-scroll">
                  <table className="wr-table wr-breakdown-table">
                    <caption>{group.title}</caption>
                    <thead><tr className="wr-super-header"><th colSpan={4}>{group.title}</th></tr><tr><th>Tên</th><th>P&amp;L sau phí</th><th>Lot</th><th>Winrate</th></tr></thead>
                    <tbody>{group.rows.map((row) => <tr key={row.name}><th scope="row">{row.name}</th><td className={valueClass(row.pnl)}>{formatUsd(row.pnl)}</td><td>{formatDecimal(row.lots)}</td><td>{formatPercent(row.winrate)}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="wr-empty-state">
          <div aria-hidden="true">▦</div>
          <h2>Báo cáo tuần sẽ xuất hiện tại đây</h2>
          <p>Hoàn tất Tổng hợp lệnh, sau đó bấm “Tạo báo cáo tuần bằng AI”. Báo cáo không đọc lại workbook và không sử dụng OTE.</p>
        </section>
      )}
    </main>
  );
}
