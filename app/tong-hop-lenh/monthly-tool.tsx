'use client';

import Link from 'next/link';
import { ChangeEvent, DragEvent, KeyboardEvent, useMemo, useRef, useState } from 'react';
import {
  formatDateVN,
  formatNumber,
  type TradeRecord,
} from '../lib/excel-report';
import { extractSettledTradesWithAi } from '../lib/ai-report';
import './monthly-report.css';

type CellKind = 'text' | 'date' | 'integer' | 'number' | 'money';

type Column = {
  key: keyof TradeRecord;
  label: string;
  kind: CellKind;
  width: number;
};

const COLUMNS: Column[] = [
  { key: 'reportDate', label: 'Ngày báo cáo', kind: 'date', width: 112 },
  { key: 'bank', label: 'Ngân hàng', kind: 'text', width: 118 },
  { key: 'account', label: 'Tài khoản', kind: 'text', width: 132 },
  { key: 'sourceSheet', label: 'Sheet gốc', kind: 'text', width: 132 },
  { key: 'sourceRow', label: 'Dòng gốc', kind: 'integer', width: 90 },
  { key: 'sourceStt', label: 'STT gốc', kind: 'integer', width: 84 },
  { key: 'trader', label: 'Người thực hiện', kind: 'text', width: 150 },
  { key: 'openDate', label: 'Ngày mở lệnh', kind: 'date', width: 118 },
  { key: 'closeDate', label: 'Ngày tất toán', kind: 'date', width: 122 },
  { key: 'expiryDate', label: 'Ngày đáo hạn', kind: 'date', width: 118 },
  { key: 'contractCode', label: 'Mã hợp đồng', kind: 'text', width: 126 },
  { key: 'commodity', label: 'Mặt hàng', kind: 'text', width: 104 },
  { key: 'position', label: 'Vị thế', kind: 'text', width: 86 },
  { key: 'openPrice', label: 'Giá mở', kind: 'number', width: 110 },
  { key: 'closePrice', label: 'Giá đóng', kind: 'number', width: 110 },
  { key: 'lots', label: 'Khối lượng quy đổi (lot)', kind: 'number', width: 150 },
  { key: 'tonnes', label: 'Khối lượng quy đổi (tấn)', kind: 'number', width: 150 },
  { key: 'feeRate', label: 'Phí giao dịch (usd/mt)', kind: 'number', width: 148 },
  { key: 'totalFee', label: 'Tổng phí/lệnh', kind: 'money', width: 132 },
  { key: 'carryPrice', label: 'Giá carry (usd/mt)', kind: 'number', width: 136 },
  { key: 'pnlBeforeFee', label: 'Lợi nhuận chưa phí giao dịch', kind: 'money', width: 180 },
  { key: 'pnlAfterFee', label: 'Lợi nhuận sau phí giao dịch', kind: 'money', width: 180 },
];

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xlsm'];

function isAcceptedFile(file: File) {
  const lowerName = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function numberOrZero(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rawCell(value: unknown) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function displayCell(value: unknown, kind: CellKind) {
  if (value === null || value === undefined || value === '') return '';

  if (kind === 'date') {
    try {
      return (formatDateVN as unknown as (input: unknown) => string)(value);
    } catch {
      return rawCell(value);
    }
  }

  if (kind === 'integer') return String(value);

  if (kind === 'number' || kind === 'money') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return rawCell(value);
    try {
      return (formatNumber as unknown as (input: number, maximumFractionDigits?: number) => string)(
        parsed,
        kind === 'money' ? 2 : 4,
      );
    } catch {
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: kind === 'money' ? 2 : 0,
        maximumFractionDigits: kind === 'money' ? 2 : 4,
      }).format(parsed);
    }
  }

  return rawCell(value);
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function safeMonthLabel(monthLabel: string) {
  const trimmed = monthLabel.trim();
  if (!trimmed) return 'tháng';
  if (/^tháng\s+/i.test(trimmed)) return trimmed.replace(/^tháng/i, 'tháng');
  return `tháng ${trimmed}`;
}

function fileSlug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function MonthlyReportPage({
  userId,
  onAggregated,
}: {
  userId: string;
  onAggregated: (trades: TradeRecord[], monthLabel: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<TradeRecord[]>([]);
  const [fileName, setFileName] = useState('');
  const [monthLabel, setMonthLabel] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [bankFilter, setBankFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [traderFilter, setTraderFilter] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [aiProgress, setAiProgress] = useState('');

  const banks = useMemo(
    () => [...new Set(records.map((record) => record.bank).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')),
    [records],
  );
  const accounts = useMemo(
    () =>
      [...new Set(records.filter((record) => !bankFilter || record.bank === bankFilter).map((record) => record.account).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, 'vi'),
      ),
    [bankFilter, records],
  );
  const traders = useMemo(
    () => [...new Set(records.map((record) => record.trader).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')),
    [records],
  );

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi');
    return records.filter((record) => {
      if (bankFilter && record.bank !== bankFilter) return false;
      if (accountFilter && record.account !== accountFilter) return false;
      if (traderFilter && record.trader !== traderFilter) return false;
      if (!query) return true;
      return COLUMNS.some((column) => rawCell(record[column.key]).toLocaleLowerCase('vi').includes(query));
    });
  }, [accountFilter, bankFilter, records, search, traderFilter]);

  const totals = useMemo(
    () => ({
      lots: records.reduce((sum, record) => sum + numberOrZero(record.lots), 0),
      pnlAfterFee: records.reduce((sum, record) => sum + numberOrZero(record.pnlAfterFee), 0),
    }),
    [records],
  );

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 1800);
  };

  const loadFile = async (file?: File) => {
    if (!file) return;
    setError('');
    setNotice('');

    if (!isAcceptedFile(file)) {
      setError('Vui lòng chọn file Excel định dạng .xlsx hoặc .xlsm.');
      return;
    }

    setIsLoading(true);
    setAiProgress('Đang chuyển các sheet ngày thành dữ liệu cho Gemini…');
    try {
      const parsed = await extractSettledTradesWithAi(
        await file.arrayBuffer(),
        userId,
        (done, total) => setAiProgress('Gemini đang đọc nhóm ' + done + '/' + total + '…'),
      );
      setRecords(parsed.trades);
      setFileName(file.name);
      setMonthLabel(parsed.monthLabel);
      setWarnings(parsed.warnings);
      onAggregated(parsed.trades, parsed.monthLabel);
      setSearch('');
      setBankFilter('');
      setAccountFilter('');
      setTraderFilter('');
      if (!parsed.trades.length) {
        setError('Gemini không tìm thấy dòng đã hạch toán hợp lệ trong các sheet ngày.');
      } else {
        showNotice(`AI đã tổng hợp ${parsed.trades.length} lệnh đã hạch toán.`);
      }
    } catch (readError) {
      console.error(readError);
      setRecords([]);
      setFileName('');
      setMonthLabel('');
      setWarnings([]);
      onAggregated([], '');
      setError(readError instanceof Error ? readError.message : 'Không thể đọc file Excel bằng Gemini.');
    } finally {
      setIsLoading(false);
      setAiProgress('');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    void loadFile(event.target.files?.[0]);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void loadFile(event.dataTransfer.files?.[0]);
  };

  const copyCell = async (value: unknown) => {
    try {
      await writeClipboard(rawCell(value));
      showNotice('Đã sao chép ô.');
    } catch {
      setError('Trình duyệt không cho phép sao chép. Hãy thử lại bằng Ctrl/Cmd+C.');
    }
  };

  const handleCellKeyDown = (event: KeyboardEvent<HTMLTableCellElement>, value: unknown) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      void copyCell(value);
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void copyCell(value);
    }
  };

  const copyTsv = async () => {
    if (!filteredRecords.length) return;
    const lines = [
      COLUMNS.map((column) => column.label).join('\t'),
      ...filteredRecords.map((record) => COLUMNS.map((column) => rawCell(record[column.key])).join('\t')),
    ];
    try {
      await writeClipboard(lines.join('\n'));
      showNotice(`Đã sao chép ${filteredRecords.length} dòng dạng TSV.`);
    } catch {
      setError('Không thể sao chép bảng. Vui lòng kiểm tra quyền clipboard của trình duyệt.');
    }
  };

  const downloadExcel = async () => {
    if (!records.length) return;
    setIsExporting(true);
    setError('');
    try {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'SIM Report — Stavian';
      workbook.created = new Date();
      const fullSheetName = `Tổng hợp lệnh ${safeMonthLabel(monthLabel)}`;
      const sheet = workbook.addWorksheet(fullSheetName.slice(0, 31), {
        views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }],
      });

      sheet.columns = COLUMNS.map((column) => ({
        header: column.label,
        key: String(column.key),
        width: Math.max(12, Math.round(column.width / 8)),
      }));

      records.forEach((record, index) => {
        const excelRow = index + 2;
        const row = sheet.addRow(
          COLUMNS.map((column) => {
            const value = record[column.key];
            if (column.kind === 'date') return displayCell(value, 'date');
            return value ?? '';
          }),
        );

        row.getCell(19).value = {
          formula: `Q${excelRow}*R${excelRow}*2`,
          result: numberOrZero(record.totalFee),
        };
        row.getCell(21).value = {
          formula: `IF(M${excelRow}="Long",(O${excelRow}-N${excelRow})*Q${excelRow},(N${excelRow}-O${excelRow})*Q${excelRow})`,
          result: numberOrZero(record.pnlBeforeFee),
        };
        row.getCell(22).value = {
          formula: `U${excelRow}-S${excelRow}`,
          result: numberOrZero(record.pnlAfterFee),
        };

        row.height = 22;
        row.eachCell((cell, columnNumber) => {
          cell.border = {
            bottom: { style: 'hair', color: { argb: 'FFD8E2DD' } },
            right: { style: 'hair', color: { argb: 'FFE7ECE9' } },
          };
          cell.alignment = { vertical: 'middle', horizontal: columnNumber >= 14 ? 'right' : 'left' };
        });
        [14, 15, 16, 17, 18, 19, 20, 21, 22].forEach((columnNumber) => {
          row.getCell(columnNumber).numFmt = '#,##0.00####;[Red]-#,##0.00####';
        });
        const pnlCell = row.getCell(22);
        pnlCell.font = {
          color: { argb: numberOrZero(record.pnlAfterFee) >= 0 ? 'FF137A4A' : 'FFBE394A' },
          bold: true,
        };
      });

      const header = sheet.getRow(1);
      header.height = 42;
      header.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF087052' } };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = { right: { style: 'thin', color: { argb: 'FF2A8A70' } } };
      });
      sheet.autoFilter = { from: 'A1', to: 'V1' };

      const buffer = await workbook.xlsx.writeBuffer();
      const bytes = new Uint8Array(buffer);
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${fileSlug(fullSheetName) || 'Tong-hop-lenh'}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showNotice('Đã tạo file Excel tổng hợp.');
    } catch (exportError) {
      console.error(exportError);
      setError('Không thể tạo file Excel. Vui lòng thử lại.');
    } finally {
      setIsExporting(false);
    }
  };

  const resetFilters = () => {
    setSearch('');
    setBankFilter('');
    setAccountFilter('');
    setTraderFilter('');
  };

  return (
    <main className="monthly-page">
      <header className="monthly-header">
        <Link className="monthly-brand" href="/" aria-label="SIM Report — về trang đọc ảnh">
          <span className="monthly-brand-mark" aria-hidden="true">S</span>
          <span>
            <strong>SIM Report</strong>
            <small>Chuẩn hóa báo cáo LME</small>
          </span>
        </Link>
        <nav className="monthly-nav" aria-label="Điều hướng công cụ">
          <Link href="/">Đọc ảnh</Link>
          <Link className="active" href="/tong-hop-lenh" aria-current="page">Tổng hợp lệnh</Link>
          <Link href="/bao-cao-tuan">Báo cáo tuần</Link>
        </nav>
      </header>

      <section className="monthly-hero">
        <div>
          <span className="monthly-eyebrow">SỔ LỆNH THÁNG</span>
          <h1>Tổng hợp toàn bộ lệnh hạch toán</h1>
          <p>
            Tải workbook báo cáo lên. Gemini API của tài khoản bạn chỉ đọc các bảng hạch toán trong sheet ngày,
            bỏ vị thế và OTE, rồi chuẩn hóa về đúng 22 cột.
          </p>
        </div>
        <div className="monthly-hero-note" aria-label="Quy tắc tính">
          <span>Công thức chuẩn</span>
          <strong>Tổng phí = Tấn × Phí × 2</strong>
          <small>Lợi nhuận sau phí = Lợi nhuận trước phí − Tổng phí</small>
        </div>
      </section>

      <section className="monthly-upload-panel" aria-labelledby="upload-title">
        <div
          className={`monthly-dropzone ${isDragging ? 'dragging' : ''} ${isLoading ? 'loading' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setIsDragging(false);
          }}
          onDrop={handleDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
            onChange={handleInput}
            aria-label="Chọn file Excel báo cáo"
          />
          <div className="monthly-upload-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img">
              <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V15" />
            </svg>
          </div>
          <div>
            <h2 id="upload-title">{isLoading ? aiProgress || 'Gemini đang đọc workbook…' : 'Thả file Excel vào đây'}</h2>
            <p>Chấp nhận .xlsx và .xlsm · Nội dung sheet ngày được gửi tới Gemini API của bạn</p>
          </div>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={isLoading}>
            {records.length ? 'Chọn file khác' : 'Chọn file Excel'}
          </button>
        </div>

        {fileName && (
          <div className="monthly-file-status">
            <span className="monthly-file-icon" aria-hidden="true">XLSX</span>
            <span className="monthly-file-copy">
              <strong>{fileName}</strong>
              <small>
                AI đã tổng hợp từ các bảng hạch toán trong sheet ngày
                {monthLabel ? ` · ${safeMonthLabel(monthLabel)}` : ''}
              </small>
            </span>
            <span className="monthly-ready">Sẵn sàng</span>
          </div>
        )}
      </section>

      {error && <div className="monthly-alert error" role="alert">{error}</div>}
      {!!warnings.length && (
        <details className="monthly-alert warning">
          <summary>{warnings.length} lưu ý khi đọc file</summary>
          <ul>{warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
        </details>
      )}

      {records.length > 0 ? (
        <>
          <section className="monthly-metrics" aria-label="Tổng quan dữ liệu">
            <article>
              <span>Tổng số lệnh</span>
              <strong>{records.length}</strong>
              <small>{filteredRecords.length !== records.length ? `${filteredRecords.length} dòng đang hiển thị` : 'dòng hạch toán'}</small>
            </article>
            <article>
              <span>Khối lượng quy đổi</span>
              <strong>{displayCell(totals.lots, 'number')}</strong>
              <small>lot</small>
            </article>
            <article className={totals.pnlAfterFee >= 0 ? 'positive' : 'negative'}>
              <span>Lợi nhuận sau phí</span>
              <strong>{displayCell(totals.pnlAfterFee, 'money')}</strong>
              <small>USD</small>
            </article>
            <article>
              <span>Nguồn dữ liệu</span>
              <strong className="source-value">Gemini API</strong>
              <small>chỉ lệnh đã hạch toán</small>
            </article>
          </section>

          <section className="monthly-table-card" aria-labelledby="table-title">
            <div className="monthly-table-heading">
              <div>
                <span className="monthly-section-index">01</span>
                <div>
                  <h2 id="table-title">{`Tổng hợp lệnh ${safeMonthLabel(monthLabel)}`}</h2>
                  <p>Chạm vào một ô để sao chép; hoặc chọn ô rồi nhấn Ctrl/Cmd+C.</p>
                </div>
              </div>
              <div className="monthly-actions">
                <button type="button" className="secondary" onClick={() => void copyTsv()} disabled={!filteredRecords.length}>
                  Sao chép TSV
                </button>
                <button type="button" className="primary" onClick={() => void downloadExcel()} disabled={isExporting}>
                  {isExporting ? 'Đang tạo Excel…' : 'Tải xuống Excel'}
                </button>
              </div>
            </div>

            <div className="monthly-filters">
              <label className="monthly-search">
                <span>Tìm kiếm</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Tên người, tài khoản, mã hợp đồng…"
                />
              </label>
              <label>
                <span>Ngân hàng</span>
                <select
                  value={bankFilter}
                  onChange={(event) => {
                    setBankFilter(event.target.value);
                    setAccountFilter('');
                  }}
                >
                  <option value="">Tất cả</option>
                  {banks.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
                </select>
              </label>
              <label>
                <span>Tài khoản</span>
                <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
                  <option value="">Tất cả</option>
                  {accounts.map((account) => <option key={account} value={account}>{account}</option>)}
                </select>
              </label>
              <label>
                <span>Người thực hiện</span>
                <select value={traderFilter} onChange={(event) => setTraderFilter(event.target.value)}>
                  <option value="">Tất cả</option>
                  {traders.map((trader) => <option key={trader} value={trader}>{trader}</option>)}
                </select>
              </label>
              <button className="monthly-clear" type="button" onClick={resetFilters} disabled={!search && !bankFilter && !accountFilter && !traderFilter}>
                Xóa lọc
              </button>
            </div>

            <div className="monthly-table-meta">
              <span>Hiển thị <strong>{filteredRecords.length}</strong> / {records.length} dòng</span>
              <span>Kéo ngang để xem đủ 22 cột</span>
            </div>

            <div className="monthly-table-scroll" role="region" aria-label="Bảng tổng hợp lệnh hạch toán" tabIndex={0}>
              <table>
                <colgroup>
                  {COLUMNS.map((column) => <col key={String(column.key)} style={{ width: column.width }} />)}
                </colgroup>
                <thead>
                  <tr>{COLUMNS.map((column) => <th key={String(column.key)}>{column.label}</th>)}</tr>
                </thead>
                <tbody>
                  {filteredRecords.length ? (
                    filteredRecords.map((record, rowIndex) => (
                      <tr key={`${record.sourceSheet}-${record.sourceRow}-${record.sourceStt}-${rowIndex}`}>
                        {COLUMNS.map((column) => {
                          const value = record[column.key];
                          const numeric = numberOrZero(value);
                          const isPnl = column.key === 'pnlBeforeFee' || column.key === 'pnlAfterFee';
                          return (
                            <td
                              key={String(column.key)}
                              className={`${column.kind === 'number' || column.kind === 'money' || column.kind === 'integer' ? 'numeric' : ''} ${isPnl ? (numeric >= 0 ? 'pnl-positive' : 'pnl-negative') : ''}`}
                              tabIndex={0}
                              title="Nhấp để sao chép ô"
                              onClick={() => void copyCell(value)}
                              onKeyDown={(event) => handleCellKeyDown(event, value)}
                            >
                              {displayCell(value, column.kind)}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="monthly-empty-row" colSpan={COLUMNS.length}>
                        Không có dòng nào khớp bộ lọc hiện tại.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="monthly-empty-state">
          <span>22</span>
          <div>
            <h2>Một bảng chuẩn, đủ 22 trường dữ liệu</h2>
            <p>
              Sau khi chọn file, toàn bộ lệnh sẽ xuất hiện tại đây cùng bộ lọc, thao tác sao chép và nút tải xuống Excel.
            </p>
          </div>
        </section>
      )}

      {notice && <div className="monthly-toast" role="status">{notice}</div>}
    </main>
  );
}


