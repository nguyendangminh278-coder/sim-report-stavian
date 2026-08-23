'use client';

import { ChangeEvent, DragEvent, Fragment, KeyboardEvent, useEffect, useMemo, useState } from 'react';
import {
  ACCOUNT_OPTIONS,
  AccountReport,
  AiResult,
  ImageType,
  PositionRow,
  TradeRow,
  buildExtractionPrompt,
  calculateTrade,
  createGeminiResponseSchema,
  formatLots,
  formatNumber,
  imageTypeLabel,
  inferImageType,
  maturityDateFromCode,
  maturityFromCode,
  normalizePositions,
  normalizeTrades,
  parseImageNumber,
  productFromCode,
  selectAiData,
  weightedPositionSummary,
} from './lib/report-v2';

type QueueStatus = 'waiting' | 'reading' | 'done' | 'error';

type QueueItem = {
  id: string;
  file: File;
  preview: string;
  expectedType: ImageType;
  status: QueueStatus;
  message: string;
};

const POSITION_HEADERS = [
  'Sản phẩm',
  'Tháng đáo hạn',
  'Mã',
  'Giá mua',
  'KL mua',
  'Giá bán',
  'KL bán',
  'OTE tạm tính (USD)',
  'Ghi chú',
];

const TRADE_HEADERS = [
  'STT',
  'Người thực hiện',
  'Ngày mở lệnh',
  'Ngày tất toán',
  'Ngày đáo hạn',
  'Mã hợp đồng',
  'Mặt hàng',
  'Vị thế',
  'Giá mở',
  'Giá đóng',
  'Khối lượng quy đổi (lot)',
  'Khối lượng quy đổi (tấn)',
  'Phí giao dịch (usd/mt)',
  'Tổng phí/lệnh',
  'Giá carry (usd/mt)',
  'Lợi nhuận chưa phí giao dịch',
  'Lợi nhuận sau phí giao dịch',
];

const STANDARD_PRODUCTS = ['Nhôm', 'Đồng', 'Kẽm'];

function uid(prefix: string) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random()}`;
}

function todayVi() {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date());
}

function escapeMarkdown(value: unknown) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function markdownTable(headers: string[], rows: Array<Array<unknown>>) {
  return [
    `| ${headers.map(escapeMarkdown).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeMarkdown).join(' | ')} |`),
  ].join('\n');
}

function positionGroups(rows: PositionRow[]) {
  const groups = STANDARD_PRODUCTS.map((name) => ({
    name,
    rows: rows.filter((row) => row.product === name),
  }));
  const otherRows = rows.filter((row) => !STANDARD_PRODUCTS.includes(row.product));
  if (otherRows.length) groups.push({ name: 'Khác', rows: otherRows });
  return groups;
}

function positionRows(report: AccountReport) {
  const rows: Array<Array<unknown>> = [];
  for (const group of positionGroups(report.positions)) {
    if (group.rows.length) {
      group.rows.forEach((row, index) => {
        rows.push([
          index === 0 ? group.name : '',
          row.maturity,
          row.code,
          formatNumber(row.buyPrice),
          formatLots(row.buyLots),
          formatNumber(row.sellPrice),
          formatLots(row.sellLots),
          formatNumber(row.ote),
          row.note,
        ]);
      });
    } else {
      rows.push([group.name, '', '', '', '', '', '', '', '']);
    }
    const summary = weightedPositionSummary(group.rows);
    rows.push([
      '',
      'Giá trung bình',
      '',
      formatNumber(summary.averageBuy),
      formatLots(summary.buyLots || null),
      formatNumber(summary.averageSell),
      formatLots(summary.sellLots || null),
      formatNumber(summary.ote),
      '',
    ]);
  }
  const total = report.positions.reduce((sum, row) => sum + (row.ote ?? 0), 0);
  rows.push(['Tổng lãi/lỗ đang mở (OTE):', '', '', '', '', '', '', formatNumber(total), '']);
  return rows;
}

function tradeRows(report: AccountReport) {
  const rows = report.trades.map((row, index) => {
    const calc = calculateTrade(row, report.fee);
    return [
      index + 1,
      row.executor,
      row.openDate,
      row.closeDate,
      row.maturityDate,
      row.code,
      productFromCode(row.code),
      row.side,
      formatNumber(row.openPrice),
      formatNumber(row.closePrice),
      formatLots(row.lots),
      formatLots(calc.tons),
      String(report.fee),
      formatNumber(calc.totalFee),
      formatNumber(row.carry),
      formatNumber(calc.beforeFee),
      formatNumber(calc.afterFee),
    ];
  });
  const totals = report.trades.reduce(
    (sum, row) => {
      const calc = calculateTrade(row, report.fee);
      sum.fee += calc.totalFee ?? 0;
      sum.before += calc.beforeFee ?? 0;
      sum.after += calc.afterFee ?? 0;
      return sum;
    },
    { fee: 0, before: 0, after: 0 },
  );
  if (report.trades.length) {
    rows.push([
      'Tổng', '', '', '', '', '', '', '', '', '', '', '', '',
      formatNumber(totals.fee), '', formatNumber(totals.before), formatNumber(totals.after),
    ]);
  }
  return rows;
}

function reportMarkdown(report: AccountReport, reportDate: string, operatorName: string) {
  const blocks: string[] = [
    `## Báo cáo trực lệnh LME - ngày ${reportDate || ''}`,
    `Người trực: ${operatorName || ''}`,
  ];
  blocks.push(
    `### ${report.accountName} — ${report.accountCode} — Vị thế đang có`,
    markdownTable(POSITION_HEADERS, positionRows(report)),
  );
  if (report.noTrades && !report.trades.length) {
    blocks.push(
      `### ${report.accountName} — ${report.accountCode} — Hạch toán lợi nhuận giao dịch`,
      'Không có phát sinh hạch toán giao dịch.',
    );
  } else if (report.trades.length) {
    blocks.push(
      `### ${report.accountName} — ${report.accountCode} — Hạch toán lợi nhuận giao dịch`,
      markdownTable(TRADE_HEADERS, tradeRows(report)),
    );
  }
  return blocks.join('\n\n');
}

function reportTsv(report: AccountReport, reportDate: string, operatorName: string) {
  const blocks: string[] = [
    `Báo cáo trực lệnh LME - ngày ${reportDate || ''}`,
    `Người trực: ${operatorName || ''}`,
    `Vị thế đang có: ${report.accountName} — ${report.accountCode}`,
    [POSITION_HEADERS, ...positionRows(report)].map((row) => row.join('\t')).join('\n'),
  ];
  if (report.noTrades && !report.trades.length) {
    blocks.push('HẠCH TOÁN LỢI NHUẬN GIAO DỊCH', 'Không có phát sinh hạch toán giao dịch.');
  } else if (report.trades.length) {
    blocks.push(
      'HẠCH TOÁN LỢI NHUẬN GIAO DỊCH',
      [TRADE_HEADERS, ...tradeRows(report)].map((row) => row.join('\t')).join('\n'),
    );
  }
  return blocks.join('\n\n');
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

function confidenceLabel(value: number | null) {
  if (value === null) return 'Chưa chấm';
  if (value >= 0.9) return 'Rõ';
  if (value >= 0.75) return 'Cần rà';
  return 'Rủi ro';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Không đọc được file ảnh.'));
    reader.readAsDataURL(file);
  });
}

function strictSchema(type: ImageType) {
  const schema = createGeminiResponseSchema(type) as {
    properties: Record<string, unknown>;
    required: string[];
    [key: string]: unknown;
  };
  if (type === 'positions') {
    delete schema.properties.trades;
    schema.required = schema.required.filter((field) => field !== 'trades');
  }
  if (type === 'trades') {
    delete schema.properties.positions;
    schema.required = schema.required.filter((field) => field !== 'positions');
  }
  return schema;
}

export default function WorkspaceV2() {
  const firstAccount = ACCOUNT_OPTIONS[1];
  const [accountName, setAccountName] = useState<string>(firstAccount.name);
  const [accountCode, setAccountCode] = useState<string>(firstAccount.code);
  const [fee, setFee] = useState<number>(firstAccount.fee);
  const [reportDate, setReportDate] = useState(todayVi);
  const [operatorName, setOperatorName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [rememberKey, setRememberKey] = useState(false);
  const [model, setModel] = useState('gemini-3.5-flash-lite');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [reports, setReports] = useState<AccountReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const savedKey = localStorage.getItem('sim_report_gemini_key');
    const sessionKey = sessionStorage.getItem('sim_report_gemini_key');
    const savedModel = localStorage.getItem('sim_report_model');
    if (savedKey) {
      setApiKey(savedKey);
      setRememberKey(true);
    } else if (sessionKey) {
      setApiKey(sessionKey);
    }
    if (savedModel) setModel(savedModel);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const totalRows = useMemo(
    () => reports.reduce((sum, report) => sum + report.positions.length + report.trades.length, 0),
    [reports],
  );

  function chooseAccount(name: string) {
    const selected = ACCOUNT_OPTIONS.find((item) => item.name === name);
    if (!selected) return;
    setAccountName(selected.name);
    setAccountCode(selected.code);
    setFee(selected.fee);
  }

  function persistSettings() {
    localStorage.setItem('sim_report_model', model.trim());
    if (rememberKey) {
      localStorage.setItem('sim_report_gemini_key', apiKey.trim());
      sessionStorage.removeItem('sim_report_gemini_key');
    } else {
      localStorage.removeItem('sim_report_gemini_key');
      sessionStorage.setItem('sim_report_gemini_key', apiKey.trim());
    }
    setToast(rememberKey ? 'Đã lưu trên thiết bị này' : 'Chỉ lưu trong phiên hiện tại');
  }

  async function callGemini(file: File, expectedType: ImageType): Promise<AiResult> {
    const key = apiKey.trim();
    const modelId = model.trim();
    if (!key) throw new Error('Chưa có Gemini API Key.');
    if (!modelId) throw new Error('Chưa chọn model Gemini.');

    const data = await fileToBase64(file);
    const prompt = buildExtractionPrompt(accountName, accountCode, fee, file.name, expectedType);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ inlineData: { mimeType: file.type || 'image/jpeg', data } }, { text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
            responseSchema: strictSchema(expectedType),
          },
        }),
      },
    );

    const payload = (await response.json()) as {
      error?: { code?: number; message?: string };
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    };
    if (!response.ok || payload.error) {
      const code = payload.error?.code || response.status;
      const message = payload.error?.message || 'Gemini không xử lý được ảnh.';
      if (code === 429) throw new Error('Đã hết quota miễn phí tạm thời. Thử lại sau.');
      if (code === 401 || code === 403) throw new Error('API Key không hợp lệ hoặc chưa được cấp quyền.');
      if (code === 404) throw new Error(`Model “${modelId}” không khả dụng. Hãy đổi model trong Cấu hình AI.`);
      throw new Error(`Gemini lỗi ${code}: ${message}`);
    }

    const raw = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
    if (!raw) throw new Error('Gemini trả về kết quả rỗng.');
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    try {
      return JSON.parse(clean) as AiResult;
    } catch {
      throw new Error('Kết quả AI không đúng JSON. Hãy thử crop ảnh sát bảng hơn.');
    }
  }

  function mergeAiResult(result: AiResult, fileName: string, expectedType: ImageType) {
    const selected = selectAiData(result, expectedType);
    const positions = normalizePositions(selected.positions);
    const trades = normalizeTrades(selected.trades);
    const reportId = `${accountName}::${accountCode || accountName}`;
    const qualityWarnings = [
      ...selected.warnings,
      ...positions
        .filter((row) => row.confidence !== null && row.confidence < 0.75)
        .map((row) => `Vị thế ${row.code}: độ tin cậy thấp.`),
      ...trades
        .filter((row) => row.confidence !== null && row.confidence < 0.75)
        .map((row) => `Hạch toán ${row.code}: độ tin cậy thấp.`),
    ];

    for (const row of trades) {
      const calc = calculateTrade(row, fee);
      if (
        row.reportedPl !== null &&
        calc.beforeFee !== null &&
        Math.abs(row.reportedPl - calc.beforeFee) > 0.01
      ) {
        qualityWarnings.push(
          `${row.code}: P/L trên ảnh ${formatNumber(row.reportedPl)} khác công thức ${formatNumber(calc.beforeFee)}.`,
        );
      }
    }
    if (expectedType === 'positions' && !positions.length) {
      qualityWarnings.push(`${fileName}: chưa trích xuất được dòng PO nào; hãy kiểm tra crop ảnh hoặc đổi model.`);
    }
    if (expectedType === 'trades' && !trades.length && !selected.noTrades) {
      qualityWarnings.push(`${fileName}: chưa ghép được giao dịch PS nào; hãy kiểm tra lại từng cặp L/S.`);
    }

    setReports((current) => {
      const existing = current.find((item) => item.id === reportId);
      const next: AccountReport = existing
        ? {
            ...existing,
            fee,
            positions: [...existing.positions, ...positions],
            trades: [...existing.trades, ...trades],
            noTrades: selected.noTrades ? true : trades.length ? false : existing.noTrades,
            warnings: [...existing.warnings, ...qualityWarnings],
            sourceFiles: [...existing.sourceFiles, `${fileName} · ${imageTypeLabel(selected.resolvedType)}`],
          }
        : {
            id: reportId,
            accountName,
            accountCode: accountCode || accountName,
            fee,
            positions,
            trades,
            noTrades: selected.noTrades,
            warnings: qualityWarnings,
            sourceFiles: [`${fileName} · ${imageTypeLabel(selected.resolvedType)}`],
          };
      return existing ? current.map((item) => (item.id === reportId ? next : item)) : [...current, next];
    });
    return { count: positions.length + trades.length, resolvedType: selected.resolvedType, noTrades: selected.noTrades };
  }

  async function processItems(items: QueueItem[]) {
    if (!items.length || busy) return;
    if (!apiKey.trim()) {
      setToast('Nhập Gemini API Key trước khi đọc ảnh');
      return;
    }
    if (items.some((item) => item.expectedType === 'auto')) {
      setToast('Ảnh chưa rõ tên sẽ do AI tự phân loại; bạn có thể chọn PO/PS để chắc chắn hơn');
    }
    setBusy(true);
    persistSettings();
    for (const item of items) {
      setQueue((current) => current.map((entry) => entry.id === item.id
        ? { ...entry, status: 'reading', message: `Đang đọc ${imageTypeLabel(item.expectedType)}…` }
        : entry));
      try {
        const result = await callGemini(item.file, item.expectedType);
        const merged = mergeAiResult(result, item.file.name, item.expectedType);
        const message = merged.noTrades
          ? 'Không có phát sinh hạch toán.'
          : `Đã nhận ${merged.count} dòng · ${imageTypeLabel(merged.resolvedType)}.`;
        setQueue((current) => current.map((entry) => entry.id === item.id
          ? { ...entry, status: 'done', message }
          : entry));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Không đọc được ảnh.';
        setQueue((current) => current.map((entry) => entry.id === item.id
          ? { ...entry, status: 'error', message }
          : entry));
      }
    }
    setBusy(false);
  }

  function enqueueFiles(files: File[]) {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (!imageFiles.length) {
      setToast('Chỉ nhận file ảnh PNG, JPG, WEBP hoặc GIF');
      return;
    }
    const items = imageFiles.map((file) => {
      const expectedType = inferImageType(file.name);
      return {
        id: uid('file'),
        file,
        preview: URL.createObjectURL(file),
        expectedType,
        status: 'waiting' as const,
        message: expectedType === 'auto'
          ? 'Chưa rõ tên file · hãy chọn PO hoặc PS'
          : `Đã khóa theo tên file: ${imageTypeLabel(expectedType)}`,
      };
    });
    setQueue((current) => [...items, ...current]);
    setToast('Kiểm tra nhãn PO/PS rồi bấm “Đọc ảnh đã chọn”');
  }

  function changeQueueType(id: string, expectedType: ImageType) {
    setQueue((current) => current.map((item) => item.id === id && item.status !== 'reading' && item.status !== 'done'
      ? { ...item, expectedType, status: 'waiting', message: `Đã chọn: ${imageTypeLabel(expectedType)}` }
      : item));
  }

  function removeQueueItem(id: string) {
    setQueue((current) => {
      const found = current.find((item) => item.id === id);
      if (found) URL.revokeObjectURL(found.preview);
      return current.filter((item) => item.id !== id);
    });
  }

  function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    enqueueFiles(Array.from(event.target.files || []));
    event.target.value = '';
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    enqueueFiles(Array.from(event.dataTransfer.files || []));
  }

  function patchPosition(reportId: string, rowId: string, patch: Partial<PositionRow>) {
    setReports((current) => current.map((report) => report.id === reportId
      ? {
          ...report,
          positions: report.positions.map((row) => {
            if (row.id !== rowId) return row;
            const next = { ...row, ...patch };
            if (patch.code !== undefined) {
              next.code = patch.code.toUpperCase();
              next.product = productFromCode(next.code);
              next.maturity = maturityFromCode(next.code) || next.maturity;
            }
            return next;
          }),
        }
      : report));
  }

  function patchTrade(reportId: string, rowId: string, patch: Partial<TradeRow>) {
    setReports((current) => current.map((report) => report.id === reportId
      ? {
          ...report,
          trades: report.trades.map((row) => {
            if (row.id !== rowId) return row;
            const next = { ...row, ...patch };
            if (patch.code !== undefined) {
              next.code = patch.code.toUpperCase();
              next.maturityDate = maturityDateFromCode(next.code) || next.maturityDate;
            }
            return next;
          }),
        }
      : report));
  }

  function removePosition(reportId: string, rowId: string) {
    setReports((current) => current.map((report) => report.id === reportId
      ? { ...report, positions: report.positions.filter((row) => row.id !== rowId) }
      : report));
  }

  function removeTrade(reportId: string, rowId: string) {
    setReports((current) => current.map((report) => report.id === reportId
      ? { ...report, trades: report.trades.filter((row) => row.id !== rowId) }
      : report));
  }

  function addPosition(report: AccountReport) {
    const row: PositionRow = {
      id: uid('position'), product: '', maturity: '', code: '',
      buyPrice: null, buyLots: null, sellPrice: null, sellLots: null,
      ote: null, note: '', confidence: null,
    };
    setReports((current) => current.map((item) => item.id === report.id
      ? { ...item, positions: [...item.positions, row] }
      : item));
  }

  function addTrade(report: AccountReport) {
    const row: TradeRow = {
      id: uid('trade'), executor: '', openDate: '', closeDate: '', maturityDate: '',
      code: '', side: '', openPrice: null, closePrice: null, lots: null,
      carry: null, reportedPl: null, confidence: null,
    };
    setReports((current) => current.map((item) => item.id === report.id
      ? { ...item, noTrades: false, trades: [...item.trades, row] }
      : item));
  }

  async function copyReport(report: AccountReport, type: 'markdown' | 'tsv') {
    await copyText(type === 'markdown'
      ? reportMarkdown(report, reportDate, operatorName)
      : reportTsv(report, reportDate, operatorName));
    setToast(type === 'markdown' ? 'Đã copy Markdown' : 'Đã copy để dán vào Google Sheet');
  }

  async function copyAll() {
    await copyText(reports.map((report) => reportMarkdown(report, reportDate, operatorName)).join('\n\n'));
    setToast('Đã copy toàn bộ báo cáo Markdown');
  }

  async function copyCell(value: string) {
    await copyText(value);
    setToast(value ? `Đã copy ô: ${value}` : 'Đã copy ô trống');
  }

  return (
    <main className="site-shell">
      {toast ? <div className="toast" role="status">{toast}</div> : null}
      <header className="topbar">
        <a href="#top" className="brand">SIM <span>REPORT</span></a>
        <div className="topbar-meta"><span className="live-dot" /><span>LME IMAGE → SHEET</span><b>{totalRows} dòng</b></div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">STAVIAN INDUSTRIAL METAL / DESK TOOL</p>
          <h1>Ảnh vào.<br />Bảng chuẩn ra.</h1>
          <p className="hero-lead">Khóa đúng ảnh PO và PS trước khi AI đọc, tự tính phí hai chiều và cho phép sửa hoặc copy từng ô trước khi hạch toán.</p>
        </div>
        <div className="hero-stats">
          <div><span>01</span><p>Chọn tài khoản và loại ảnh</p></div>
          <div><span>02</span><p>AI trích xuất theo schema riêng</p></div>
          <div><span>03</span><p>Đối soát rồi copy từng ô</p></div>
        </div>
      </section>

      <section className="workbench" aria-label="Khu vực đọc ảnh">
        <div className="workflow-panel">
          <div className="section-heading">
            <span className="section-number">01</span>
            <div><p>Thiết lập báo cáo</p><h2>Tài khoản, ngày báo cáo và người trực</h2></div>
          </div>
          <div className="account-grid account-grid-v2">
            <label className="field field-wide"><span>Tên tài khoản</span><select value={accountName} onChange={(event) => chooseAccount(event.target.value)}>{ACCOUNT_OPTIONS.map((account) => <option key={account.name} value={account.name}>{account.name}</option>)}</select></label>
            <label className="field"><span>Mã tài khoản</span><input value={accountCode} onChange={(event) => setAccountCode(event.target.value)} /></label>
            <label className="field"><span>Phí USD/MT</span><input inputMode="decimal" value={fee} onChange={(event) => setFee(parseImageNumber(event.target.value) ?? 0)} /></label>
            <label className="field"><span>Ngày báo cáo</span><input value={reportDate} onChange={(event) => setReportDate(event.target.value)} /></label>
            <label className="field field-wide"><span>Người trực</span><input value={operatorName} placeholder="Ví dụ: Đức" onChange={(event) => setOperatorName(event.target.value)} /></label>
          </div>
          <div className="fee-strip" aria-label="Phí mặc định theo tài khoản">{ACCOUNT_OPTIONS.map((account) => <span key={account.name} className={account.name === accountName ? 'active' : ''}>{account.name} <b>{account.fee}</b></span>)}</div>

          <div className="section-heading upload-heading">
            <span className="section-number">02</span>
            <div><p>Đưa ảnh vào hệ thống</p><h2>PO và PS được khóa riêng trước khi đọc</h2></div>
          </div>
          <label className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={onFileInput} />
            <span className="drop-icon">+</span>
            <strong>Thả ảnh vào đây hoặc bấm để chọn</strong>
            <small>Tên bắt đầu PO → Vị thế · PS → Hạch toán · Bạn có thể đổi loại trước khi đọc</small>
          </label>

          {queue.length ? (
            <div className="queue-list">
              {queue.map((item) => (
                <article className="queue-item queue-item-v2" key={item.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.preview} alt="" />
                  <div className="queue-copy"><strong>{item.file.name}</strong><span>{item.message}</span></div>
                  <label className="queue-type"><span>Loại ảnh</span><select value={item.expectedType} disabled={item.status === 'reading' || item.status === 'done'} onChange={(event) => changeQueueType(item.id, event.target.value as ImageType)}><option value="auto">Tự nhận diện</option><option value="positions">PO · Vị thế</option><option value="trades">PS · Hạch toán</option></select></label>
                  <span className={`queue-status ${item.status}`}>{item.status}</span>
                  <button type="button" className="queue-remove" aria-label={`Bỏ ${item.file.name}`} disabled={item.status === 'reading'} onClick={() => removeQueueItem(item.id)}>×</button>
                </article>
              ))}
              {queue.some((item) => item.status === 'waiting' || item.status === 'error') ? <button className="button button-dark" disabled={busy} onClick={() => void processItems(queue.filter((item) => item.status !== 'done' && item.status !== 'reading'))}>{busy ? 'Đang đọc ảnh…' : 'Đọc ảnh đã chọn'}</button> : null}
            </div>
          ) : null}
        </div>

        <aside className="settings-panel">
          <div className="section-heading compact"><span className="section-number">AI</span><div><p>Cấu hình miễn phí</p><h2>Gemini Vision</h2></div></div>
          <label className="field"><span>Gemini API Key</span><div className="key-field"><input type={showKey ? 'text' : 'password'} value={apiKey} placeholder="AIza…" onChange={(event) => setApiKey(event.target.value)} /><button type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? 'Ẩn' : 'Hiện'}</button></div></label>
          <label className="field"><span>Model</span><input value={model} onChange={(event) => setModel(event.target.value)} /></label>
          <label className="check-field"><input type="checkbox" checked={rememberKey} onChange={(event) => setRememberKey(event.target.checked)} /><span>Ghi nhớ key trên thiết bị này</span></label>
          <button className="button button-outline" onClick={persistSettings}>Lưu cấu hình</button>
          <a className="text-link" href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">Tạo API Key miễn phí ↗</a>
          <div className="privacy-note"><strong>Ranh giới dữ liệu</strong><p>Ảnh được gửi trực tiếp từ trình duyệt tới Google bằng key của bạn. Không tải ảnh có dữ liệu vượt phạm vi được phép chia sẻ.</p></div>
          <div className="rule-note"><strong>Công thức đang áp dụng</strong><code>Tấn = lot × 25</code><code>Tổng phí = tấn × phí × 2</code><code>Long: (đóng − mở) × tấn</code><code>Short: (mở − đóng) × tấn</code><p>Yêu cầu mới đã thay thế công thức một lượt trước đây.</p></div>
        </aside>
      </section>

      <section className="checks-band" aria-label="Ba lớp kiểm soát">
        <article><span>1</span><h3>Khóa PO / PS</h3><p>Tên file và lựa chọn thủ công có quyền cao hơn kết luận của AI.</p></article>
        <article><span>2</span><h3>Tính bằng công thức</h3><p>Tấn, phí hai lượt và lợi nhuận đều tính lại từ dữ liệu đã duyệt.</p></article>
        <article><span>3</span><h3>Copy từng ô</h3><p>Di chuột vào ô và bấm biểu tượng sao chép; số được copy ở dạng thô.</p></article>
      </section>

      <section className="results-section" id="results">
        <div className="results-heading"><div className="section-heading"><span className="section-number">03</span><div><p>Kết quả chuẩn hóa</p><h2>Bố cục theo mẫu báo cáo trực lệnh</h2></div></div>{reports.length ? <button className="button button-dark" onClick={() => void copyAll()}>Copy toàn bộ Markdown</button> : null}</div>
        {!reports.length ? <div className="empty-state"><span>SR</span><div><h3>Chưa có bảng báo cáo</h3><p>Chọn tài khoản, tải ảnh, kiểm tra nhãn PO/PS rồi bấm đọc ảnh.</p></div></div> : (
          <div className="report-stack">{reports.map((report) => <ReportCard key={report.id} report={report} reportDate={reportDate} operatorName={operatorName} onCopy={copyReport} onCopyCell={copyCell} onAddPosition={addPosition} onAddTrade={addTrade} onPatchPosition={patchPosition} onPatchTrade={patchTrade} onRemovePosition={removePosition} onRemoveTrade={removeTrade} onClear={(reportId) => setReports((current) => current.filter((item) => item.id !== reportId))} />)}</div>
        )}
      </section>

      <footer><span>SIM REPORT / STAVIAN INDUSTRIAL METAL</span><span>AI hỗ trợ trích xuất — người dùng đối soát trước khi hạch toán.</span></footer>
    </main>
  );
}

type ReportCardProps = {
  report: AccountReport;
  reportDate: string;
  operatorName: string;
  onCopy: (report: AccountReport, type: 'markdown' | 'tsv') => Promise<void>;
  onCopyCell: (value: string) => Promise<void>;
  onAddPosition: (report: AccountReport) => void;
  onAddTrade: (report: AccountReport) => void;
  onPatchPosition: (reportId: string, rowId: string, patch: Partial<PositionRow>) => void;
  onPatchTrade: (reportId: string, rowId: string, patch: Partial<TradeRow>) => void;
  onRemovePosition: (reportId: string, rowId: string) => void;
  onRemoveTrade: (reportId: string, rowId: string) => void;
  onClear: (reportId: string) => void;
};

function ReportCard({ report, reportDate, operatorName, onCopy, onCopyCell, onAddPosition, onAddTrade, onPatchPosition, onPatchTrade, onRemovePosition, onRemoveTrade, onClear }: ReportCardProps) {
  const totalOte = report.positions.reduce((sum, row) => sum + (row.ote ?? 0), 0);
  const groups = positionGroups(report.positions);
  const tradeTotals = report.trades.reduce((sum, row) => {
    const calc = calculateTrade(row, report.fee);
    sum.fee += calc.totalFee ?? 0;
    sum.before += calc.beforeFee ?? 0;
    sum.after += calc.afterFee ?? 0;
    return sum;
  }, { fee: 0, before: 0, after: 0 });

  return (
    <article className="report-card sheet-report">
      <header className="report-header">
        <div><p>{report.accountName}</p><h3>{report.accountCode}</h3><span>{report.sourceFiles.length} ảnh nguồn · Phí {report.fee} USD/MT · hai lượt</span></div>
        <div className="report-actions"><button className="button button-outline" onClick={() => void onCopy(report, 'markdown')}>Copy Markdown</button><button className="button button-dark" onClick={() => void onCopy(report, 'tsv')}>Copy Google Sheet</button><button className="icon-button" aria-label="Xóa báo cáo tài khoản" onClick={() => onClear(report.id)}>×</button></div>
      </header>

      <div className="sheet-banner"><strong>Báo cáo trực lệnh LME - ngày {reportDate || '...'}</strong><span>Người trực: {operatorName || '...'}</span></div>
      {report.warnings.length ? <details className="warnings" open><summary>{report.warnings.length} điểm cần rà soát</summary><ul>{report.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></details> : null}

      <div className="table-section">
        <div className="table-title"><div><p>Vị thế đang có: {report.accountName}</p><span>Tổng OTE <b className={totalOte < 0 ? 'negative' : totalOte > 0 ? 'positive' : ''}>{formatNumber(totalOte)} USD</b></span></div><button className="mini-button" onClick={() => onAddPosition(report)}>+ Thêm dòng</button></div>
        <div className="table-scroll"><table className="data-table positions-table positions-sheet">
          <thead>
            <tr><th rowSpan={2}>Sản phẩm</th><th rowSpan={2}>Tháng đáo hạn</th><th rowSpan={2}>Mã</th><th colSpan={2} className="buy-band">Mua</th><th colSpan={2} className="sell-band">Bán</th><th rowSpan={2}>OTE tạm tính<br />(USD)</th><th rowSpan={2}>Ghi chú</th><th rowSpan={2} aria-label="Thao tác" /></tr>
            <tr><th className="buy-subhead">Giá mua</th><th className="buy-subhead">KL mua</th><th className="sell-subhead">Giá bán</th><th className="sell-subhead">KL bán</th></tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const visibleRows: Array<PositionRow | null> = group.rows.length ? group.rows : [null];
              const summary = weightedPositionSummary(group.rows);
              return <Fragment key={group.name}>
                {visibleRows.map((row, index) => <tr key={row?.id || `${group.name}-empty`} className={row?.confidence !== null && row?.confidence !== undefined && row.confidence < 0.75 ? 'review-row' : ''}>
                  {index === 0 ? <ProductGroupCell value={group.name} rowSpan={visibleRows.length + 1} onCopy={onCopyCell} /> : null}
                  {row ? <>
                    <EditableCell value={row.maturity} onChange={(value) => onPatchPosition(report.id, row.id, { maturity: value })} onCopy={onCopyCell} />
                    <EditableCell value={row.code} mono onChange={(value) => onPatchPosition(report.id, row.id, { code: value })} onCopy={onCopyCell} />
                    <EditableNumber value={row.buyPrice} onChange={(value) => onPatchPosition(report.id, row.id, { buyPrice: value })} onCopy={onCopyCell} />
                    <EditableNumber value={row.buyLots} lots onChange={(value) => onPatchPosition(report.id, row.id, { buyLots: value })} onCopy={onCopyCell} />
                    <EditableNumber value={row.sellPrice} onChange={(value) => onPatchPosition(report.id, row.id, { sellPrice: value })} onCopy={onCopyCell} />
                    <EditableNumber value={row.sellLots} lots onChange={(value) => onPatchPosition(report.id, row.id, { sellLots: value })} onCopy={onCopyCell} />
                    <EditableNumber value={row.ote} pnl onChange={(value) => onPatchPosition(report.id, row.id, { ote: value })} onCopy={onCopyCell} />
                    <NoteCell value={row.note} confidence={row.confidence} onChange={(value) => onPatchPosition(report.id, row.id, { note: value })} onCopy={onCopyCell} />
                    <td><button className="row-delete" aria-label="Xóa dòng" onClick={() => onRemovePosition(report.id, row.id)}>×</button></td>
                  </> : <><td className="sheet-empty-cell" /><td className="sheet-empty-cell" /><td className="sheet-empty-cell" /><td className="sheet-empty-cell" /><td className="sheet-empty-cell" /><td className="sheet-empty-cell" /><td className="sheet-empty-cell" /><td className="sheet-empty-cell" /><td className="sheet-empty-cell" /></>}
                </tr>)}
                <tr className="average-row"><td>Giá trung bình</td><td /><CopyValueCell value={formatNumber(summary.averageBuy)} onCopy={onCopyCell} numeric /><CopyValueCell value={formatLots(summary.buyLots || null)} onCopy={onCopyCell} numeric /><CopyValueCell value={formatNumber(summary.averageSell)} onCopy={onCopyCell} numeric /><CopyValueCell value={formatLots(summary.sellLots || null)} onCopy={onCopyCell} numeric /><CopyValueCell value={formatNumber(summary.ote)} onCopy={onCopyCell} numeric pnl /><td /><td /></tr>
              </Fragment>;
            })}
            <tr className="total-row sheet-total-row"><td colSpan={7}>Tổng lãi/lỗ đang mở (OTE):</td><CopyValueCell value={formatNumber(totalOte)} onCopy={onCopyCell} numeric pnl /><td /><td /></tr>
          </tbody>
        </table></div>
      </div>

      <div className="table-section">
        <div className="table-title"><div><p>Hạch toán lợi nhuận giao dịch</p><span>Sau phí <b className={tradeTotals.after < 0 ? 'negative' : tradeTotals.after > 0 ? 'positive' : ''}>{formatNumber(tradeTotals.after)} USD</b></span></div><button className="mini-button" onClick={() => onAddTrade(report)}>+ Thêm dòng</button></div>
        {report.noTrades && !report.trades.length ? <div className="no-trades">Không có phát sinh hạch toán giao dịch.</div> : report.trades.length ? <div className="table-scroll"><table className="data-table trades-table trades-sheet">
          <thead><tr className="sheet-heading-row"><th colSpan={18}>HẠCH TOÁN LỢI NHUẬN GIAO DỊCH</th></tr><tr><th>STT</th><th>Người thực<br />hiện</th><th>Ngày mở<br />lệnh</th><th>Ngày tất toán</th><th>Ngày đáo<br />hạn</th><th>Mã hợp đồng</th><th>Mặt hàng</th><th>Vị thế</th><th>Giá mở</th><th>Giá đóng</th><th>Khối lượng<br />quy đổi (lot)</th><th>Khối lượng<br />quy đổi (tấn)</th><th>Phí giao dịch<br />(usd/mt)</th><th>Tổng<br />phí/lệnh</th><th>Giá carry<br />(usd/mt)</th><th>Lợi nhuận chưa phí<br />giao dịch</th><th>Lợi nhuận sau phí<br />giao dịch</th><th aria-label="Thao tác" /></tr></thead>
          <tbody>
            {report.trades.map((row, index) => {
              const calc = calculateTrade(row, report.fee);
              return <tr key={row.id} className={row.confidence !== null && row.confidence < 0.75 ? 'review-row' : ''}>
                <CopyValueCell value={String(index + 1)} onCopy={onCopyCell} />
                <EditableCell value={row.executor} onChange={(value) => onPatchTrade(report.id, row.id, { executor: value })} onCopy={onCopyCell} />
                <EditableCell value={row.openDate} mono onChange={(value) => onPatchTrade(report.id, row.id, { openDate: value })} onCopy={onCopyCell} />
                <EditableCell value={row.closeDate} mono onChange={(value) => onPatchTrade(report.id, row.id, { closeDate: value })} onCopy={onCopyCell} />
                <EditableCell value={row.maturityDate} mono onChange={(value) => onPatchTrade(report.id, row.id, { maturityDate: value })} onCopy={onCopyCell} />
                <EditableCell value={row.code} mono onChange={(value) => onPatchTrade(report.id, row.id, { code: value })} onCopy={onCopyCell} />
                <CopyValueCell value={productFromCode(row.code)} onCopy={onCopyCell} />
                <SelectCell value={row.side} onChange={(value) => onPatchTrade(report.id, row.id, { side: value })} onCopy={onCopyCell} />
                <EditableNumber value={row.openPrice} onChange={(value) => onPatchTrade(report.id, row.id, { openPrice: value })} onCopy={onCopyCell} />
                <EditableNumber value={row.closePrice} onChange={(value) => onPatchTrade(report.id, row.id, { closePrice: value })} onCopy={onCopyCell} />
                <EditableNumber value={row.lots} lots onChange={(value) => onPatchTrade(report.id, row.id, { lots: value })} onCopy={onCopyCell} />
                <CopyValueCell value={formatLots(calc.tons)} onCopy={onCopyCell} numeric derived />
                <CopyValueCell value={String(report.fee)} onCopy={onCopyCell} numeric derived />
                <CopyValueCell value={formatNumber(calc.totalFee)} onCopy={onCopyCell} numeric derived />
                <EditableNumber value={row.carry} onChange={(value) => onPatchTrade(report.id, row.id, { carry: value })} onCopy={onCopyCell} />
                <CopyValueCell value={formatNumber(calc.beforeFee)} onCopy={onCopyCell} numeric pnl derived />
                <CopyValueCell value={formatNumber(calc.afterFee)} onCopy={onCopyCell} numeric pnl derived detail={confidenceLabel(row.confidence)} />
                <td><button className="row-delete" aria-label="Xóa dòng" onClick={() => onRemoveTrade(report.id, row.id)}>×</button></td>
              </tr>;
            })}
            <tr className="total-row"><td>Tổng</td><td colSpan={12} /><CopyValueCell value={formatNumber(tradeTotals.fee)} onCopy={onCopyCell} numeric /><td /><CopyValueCell value={formatNumber(tradeTotals.before)} onCopy={onCopyCell} numeric pnl /><CopyValueCell value={formatNumber(tradeTotals.after)} onCopy={onCopyCell} numeric pnl /><td /></tr>
          </tbody>
        </table></div> : <p className="table-empty">Chưa đọc được hạch toán từ ảnh này.</p>}
      </div>
    </article>
  );
}

function CellCopyButton({ value, onCopy }: { value: string; onCopy: (value: string) => Promise<void> }) {
  return <button type="button" className="cell-copy" aria-label="Sao chép ô" title="Sao chép ô" onClick={() => void onCopy(value)}>⧉</button>;
}

function onCopyKey(event: KeyboardEvent<HTMLTableCellElement>, value: string, onCopy: (value: string) => Promise<void>) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    void onCopy(value);
  }
}

function ProductGroupCell({ value, rowSpan, onCopy }: { value: string; rowSpan: number; onCopy: (value: string) => Promise<void> }) {
  return <td rowSpan={rowSpan} className="product-group-cell copyable-cell" tabIndex={0} onKeyDown={(event) => onCopyKey(event, value, onCopy)}><strong>{value}</strong><CellCopyButton value={value} onCopy={onCopy} /></td>;
}

function CopyValueCell({ value, onCopy, numeric = false, pnl = false, derived = false, detail = '' }: { value: string; onCopy: (value: string) => Promise<void>; numeric?: boolean; pnl?: boolean; derived?: boolean; detail?: string }) {
  const number = parseImageNumber(value, pnl ? 'pnl' : 'regular');
  const tone = pnl && number !== null ? number < 0 ? 'negative' : number > 0 ? 'positive' : '' : '';
  return <td className={`copyable-cell static-copy-cell ${numeric ? 'numeric-cell' : ''} ${derived ? 'derived-cell' : ''} ${tone}`} tabIndex={0} onKeyDown={(event) => onCopyKey(event, value, onCopy)}><span>{value}</span>{detail ? <small>{detail}</small> : null}<CellCopyButton value={value} onCopy={onCopy} /></td>;
}

function EditableCell({ value, onChange, onCopy, mono = false }: { value: string; onChange: (value: string) => void; onCopy: (value: string) => Promise<void>; mono?: boolean }) {
  return <td className="copyable-cell"><input className={mono ? 'mono' : ''} value={value} onChange={(event) => onChange(event.target.value)} /><CellCopyButton value={value} onCopy={onCopy} /></td>;
}

function EditableNumber({ value, onChange, onCopy, lots = false, pnl = false }: { value: number | null; onChange: (value: number | null) => void; onCopy: (value: string) => Promise<void>; lots?: boolean; pnl?: boolean }) {
  const text = lots ? formatLots(value) : formatNumber(value);
  return <td className={`copyable-cell ${value !== null && value < 0 ? 'negative' : value !== null && value > 0 && pnl ? 'positive' : ''}`}><input className="mono numeric" inputMode="decimal" value={text} onChange={(event) => onChange(parseImageNumber(event.target.value, pnl ? 'pnl' : 'regular'))} /><CellCopyButton value={text} onCopy={onCopy} /></td>;
}

function NoteCell({ value, confidence, onChange, onCopy }: { value: string; confidence: number | null; onChange: (value: string) => void; onCopy: (value: string) => Promise<void> }) {
  return <td className="note-cell copyable-cell"><input value={value} onChange={(event) => onChange(event.target.value)} /><small>{confidenceLabel(confidence)}</small><CellCopyButton value={value} onCopy={onCopy} /></td>;
}

function SelectCell({ value, onChange, onCopy }: { value: TradeRow['side']; onChange: (value: TradeRow['side']) => void; onCopy: (value: string) => Promise<void> }) {
  return <td className="copyable-cell"><select value={value} onChange={(event) => onChange(event.target.value as TradeRow['side'])}><option value="" /><option value="Long">Long</option><option value="Short">Short</option></select><CellCopyButton value={value} onCopy={onCopy} /></td>;
}
