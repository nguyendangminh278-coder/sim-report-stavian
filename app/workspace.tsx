'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from 'react';
import {
  ACCOUNT_OPTIONS,
  AccountReport,
  AiResult,
  GEMINI_RESPONSE_SCHEMA,
  PositionRow,
  TradeRow,
  buildExtractionPrompt,
  calculateTrade,
  formatLots,
  formatNumber,
  maturityDateFromCode,
  maturityFromCode,
  normalizePositions,
  normalizeTrades,
  parseImageNumber,
  productFromCode,
} from './lib/report';

type QueueStatus = 'waiting' | 'reading' | 'done' | 'error';

type QueueItem = {
  id: string;
  file: File;
  preview: string;
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
  'OTE tạm tính USD',
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
  'Khối lượng lot',
  'Khối lượng tấn',
  'Phí usd/mt',
  'Tổng phí',
  'Giá carry',
  'Lợi nhuận chưa phí',
  'Lợi nhuận sau phí',
];

function uid(prefix: string) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random()}`;
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

function positionRows(report: AccountReport) {
  const rows = report.positions.map((row) => [
    row.product,
    row.maturity,
    row.code,
    formatNumber(row.buyPrice),
    formatLots(row.buyLots),
    formatNumber(row.sellPrice),
    formatLots(row.sellLots),
    formatNumber(row.ote),
    row.note,
  ]);
  const total = report.positions.reduce((sum, row) => sum + (row.ote ?? 0), 0);
  rows.push(['Tổng OTE', '', '', '', '', '', '', formatNumber(total), '']);
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
      formatNumber(row.plBeforeFee),
      formatNumber(calc.afterFee),
    ];
  });
  const totals = report.trades.reduce(
    (sum, row) => {
      const calc = calculateTrade(row, report.fee);
      sum.fee += calc.totalFee;
      sum.before += row.plBeforeFee ?? 0;
      sum.after += calc.afterFee ?? 0;
      return sum;
    },
    { fee: 0, before: 0, after: 0 },
  );
  if (report.trades.length) {
    rows.push([
      'Tổng',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      formatNumber(totals.fee),
      '',
      formatNumber(totals.before),
      formatNumber(totals.after),
    ]);
  }
  return rows;
}

function reportMarkdown(report: AccountReport) {
  const blocks: string[] = [];
  if (report.positions.length) {
    blocks.push(
      `### ${report.accountName} — ${report.accountCode} — Vị thế đang có`,
      markdownTable(POSITION_HEADERS, positionRows(report)),
    );
  }
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

function reportTsv(report: AccountReport) {
  const blocks: string[] = [];
  if (report.positions.length) {
    blocks.push(
      `${report.accountName} — ${report.accountCode} — Vị thế đang có`,
      [POSITION_HEADERS, ...positionRows(report)]
        .map((row) => row.join('\t'))
        .join('\n'),
    );
  }
  if (report.noTrades && !report.trades.length) {
    blocks.push(
      `${report.accountName} — ${report.accountCode} — Hạch toán lợi nhuận giao dịch`,
      'Không có phát sinh hạch toán giao dịch.',
    );
  } else if (report.trades.length) {
    blocks.push(
      `${report.accountName} — ${report.accountCode} — Hạch toán lợi nhuận giao dịch`,
      [TRADE_HEADERS, ...tradeRows(report)]
        .map((row) => row.join('\t'))
        .join('\n'),
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

export default function Workspace() {
  const firstAccount = ACCOUNT_OPTIONS[1];
  const [accountName, setAccountName] = useState<string>(firstAccount.name);
  const [accountCode, setAccountCode] = useState<string>(firstAccount.code);
  const [fee, setFee] = useState<number>(firstAccount.fee);
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

  async function callGemini(file: File): Promise<AiResult> {
    const key = apiKey.trim();
    const modelId = model.trim();
    if (!key) throw new Error('Chưa có Gemini API Key.');
    if (!modelId) throw new Error('Chưa chọn model Gemini.');

    const data = await fileToBase64(file);
    const prompt = buildExtractionPrompt(accountName, accountCode, fee);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inlineData: { mimeType: file.type || 'image/jpeg', data } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_RESPONSE_SCHEMA,
          },
        }),
      },
    );

    const payload = (await response.json()) as {
      error?: { code?: number; message?: string };
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
    };
    if (!response.ok || payload.error) {
      const code = payload.error?.code || response.status;
      const message = payload.error?.message || 'Gemini không xử lý được ảnh.';
      if (code === 429) throw new Error('Đã hết quota miễn phí tạm thời. Thử lại sau.');
      if (code === 401 || code === 403) throw new Error('API Key không hợp lệ hoặc chưa được cấp quyền.');
      if (code === 404) throw new Error(`Model “${modelId}” không khả dụng. Hãy đổi model trong Cấu hình AI.`);
      throw new Error(`Gemini lỗi ${code}: ${message}`);
    }

    const raw =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || '')
        .join('')
        .trim() || '';
    if (!raw) throw new Error('Gemini trả về kết quả rỗng.');
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    try {
      return JSON.parse(clean) as AiResult;
    } catch {
      throw new Error('Kết quả AI không đúng JSON. Hãy thử crop ảnh sát bảng hơn.');
    }
  }

  function mergeAiResult(result: AiResult, fileName: string) {
    const positions = normalizePositions(result.positions || []);
    const trades = normalizeTrades(result.trades || []);
    const reportId = `${accountName}::${accountCode || accountName}`;
    const qualityWarnings = [
      ...(result.warnings || []),
      ...positions
        .filter((row) => row.confidence !== null && row.confidence < 0.75)
        .map((row) => `Vị thế ${row.code}: độ tin cậy thấp.`),
      ...trades
        .filter((row) => row.confidence !== null && row.confidence < 0.75)
        .map((row) => `Hạch toán ${row.code}: độ tin cậy thấp.`),
    ];

    setReports((current) => {
      const existing = current.find((item) => item.id === reportId);
      const next: AccountReport = existing
        ? {
            ...existing,
            fee,
            positions: [...existing.positions, ...positions],
            trades: [...existing.trades, ...trades],
            noTrades:
              result.screen_type === 'no_trades'
                ? true
                : trades.length
                  ? false
                  : existing.noTrades,
            warnings: [...existing.warnings, ...qualityWarnings],
            sourceFiles: [...existing.sourceFiles, fileName],
          }
        : {
            id: reportId,
            accountName,
            accountCode: accountCode || accountName,
            fee,
            positions,
            trades,
            noTrades: result.screen_type === 'no_trades',
            warnings: qualityWarnings,
            sourceFiles: [fileName],
          };
      return existing
        ? current.map((item) => (item.id === reportId ? next : item))
        : [...current, next];
    });
  }

  async function processItems(items: QueueItem[]) {
    if (!items.length || busy) return;
    if (!apiKey.trim()) {
      setToast('Nhập Gemini API Key trước khi đọc ảnh');
      return;
    }
    setBusy(true);
    persistSettings();
    for (const item of items) {
      setQueue((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, status: 'reading', message: 'AI đang đọc và đối soát…' }
            : entry,
        ),
      );
      try {
        const result = await callGemini(item.file);
        mergeAiResult(result, item.file.name);
        const count = (result.positions?.length || 0) + (result.trades?.length || 0);
        const message =
          result.screen_type === 'no_trades'
            ? 'Không có phát sinh hạch toán.'
            : `Đã nhận ${count} dòng dữ liệu.`;
        setQueue((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, status: 'done', message } : entry,
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Không đọc được ảnh.';
        setQueue((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, status: 'error', message } : entry,
          ),
        );
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
    const items = imageFiles.map((file) => ({
      id: uid('file'),
      file,
      preview: URL.createObjectURL(file),
      status: 'waiting' as const,
      message: 'Chờ đọc',
    }));
    setQueue((current) => [...items, ...current]);
    if (apiKey.trim()) void processItems(items);
    else setToast('Ảnh đã xếp hàng — nhập API Key để bắt đầu');
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
    setReports((current) =>
      current.map((report) =>
        report.id === reportId
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
          : report,
      ),
    );
  }

  function patchTrade(reportId: string, rowId: string, patch: Partial<TradeRow>) {
    setReports((current) =>
      current.map((report) =>
        report.id === reportId
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
          : report,
      ),
    );
  }

  function removePosition(reportId: string, rowId: string) {
    setReports((current) =>
      current.map((report) =>
        report.id === reportId
          ? { ...report, positions: report.positions.filter((row) => row.id !== rowId) }
          : report,
      ),
    );
  }

  function removeTrade(reportId: string, rowId: string) {
    setReports((current) =>
      current.map((report) =>
        report.id === reportId
          ? { ...report, trades: report.trades.filter((row) => row.id !== rowId) }
          : report,
      ),
    );
  }

  function addPosition(report: AccountReport) {
    const row: PositionRow = {
      id: uid('position'),
      product: '',
      maturity: '',
      code: '',
      buyPrice: null,
      buyLots: null,
      sellPrice: null,
      sellLots: null,
      ote: null,
      note: '',
      confidence: null,
    };
    setReports((current) =>
      current.map((item) =>
        item.id === report.id ? { ...item, positions: [...item.positions, row] } : item,
      ),
    );
  }

  function addTrade(report: AccountReport) {
    const row: TradeRow = {
      id: uid('trade'),
      executor: '',
      openDate: '',
      closeDate: '',
      maturityDate: '',
      code: '',
      side: '',
      openPrice: null,
      closePrice: null,
      lots: null,
      carry: null,
      plBeforeFee: null,
      confidence: null,
    };
    setReports((current) =>
      current.map((item) =>
        item.id === report.id
          ? { ...item, noTrades: false, trades: [...item.trades, row] }
          : item,
      ),
    );
  }

  async function copyReport(report: AccountReport, type: 'markdown' | 'tsv') {
    await copyText(type === 'markdown' ? reportMarkdown(report) : reportTsv(report));
    setToast(type === 'markdown' ? 'Đã copy Markdown' : 'Đã copy để dán vào Google Sheet');
  }

  async function copyAll() {
    await copyText(reports.map(reportMarkdown).filter(Boolean).join('\n\n'));
    setToast('Đã copy toàn bộ báo cáo Markdown');
  }

  return (
    <main className="site-shell">
      {toast ? <div className="toast" role="status">{toast}</div> : null}

      <header className="topbar">
        <a className="brand" href="#top" aria-label="SIM Report">
          <span className="brand-mark">SR</span>
          <span>
            <strong>SIM REPORT</strong>
            <small>Stavian Industrial Metal</small>
          </span>
        </a>
        <div className="topbar-meta">
          <span className="live-dot" />
          <span>Công cụ 01</span>
          <strong>OCR LME</strong>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">AI đọc ảnh · Quy tắc kiểm soát · Con người duyệt</p>
          <h1>Từ ảnh giao dịch<br />thành bảng có thể kiểm tra.</h1>
          <p className="hero-lead">
            Nhận diện vị thế và hạch toán LME, chuẩn hóa số liệu theo đúng tài khoản,
            sau đó cho phép sửa từng ô trước khi copy vào Google Sheet.
          </p>
        </div>
        <div className="hero-stats" aria-label="Tổng quan phiên làm việc">
          <div><span>01</span><p>Ảnh gửi thẳng tới Gemini, không lưu trên website</p></div>
          <div><span>{String(reports.length).padStart(2, '0')}</span><p>Tài khoản đang có kết quả</p></div>
          <div><span>{String(totalRows).padStart(2, '0')}</span><p>Dòng dữ liệu để rà soát</p></div>
        </div>
      </section>

      <section className="workbench" aria-label="Khu vực đọc ảnh">
        <div className="workflow-panel">
          <div className="section-heading">
            <span className="section-number">01</span>
            <div><p>Thiết lập báo cáo</p><h2>Chọn tài khoản trước khi tải ảnh</h2></div>
          </div>

          <div className="account-grid">
            <label className="field field-wide">
              <span>Tên tài khoản</span>
              <select value={accountName} onChange={(event) => chooseAccount(event.target.value)}>
                {ACCOUNT_OPTIONS.map((account) => (
                  <option key={account.name} value={account.name}>{account.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Mã tài khoản</span>
              <input value={accountCode} onChange={(event) => setAccountCode(event.target.value)} />
            </label>
            <label className="field">
              <span>Phí USD/MT</span>
              <input
                inputMode="decimal"
                value={fee}
                onChange={(event) => setFee(parseImageNumber(event.target.value) ?? 0)}
              />
            </label>
          </div>

          <div className="fee-strip" aria-label="Phí mặc định theo tài khoản">
            {ACCOUNT_OPTIONS.map((account) => (
              <span key={account.name} className={account.name === accountName ? 'active' : ''}>
                {account.name} <b>{account.fee}</b>
              </span>
            ))}
          </div>

          <div className="section-heading upload-heading">
            <span className="section-number">02</span>
            <div><p>Đưa ảnh vào hệ thống</p><h2>Tự nhận diện Trạng thái hoặc Mua &amp; Bán</h2></div>
          </div>

          <label
            className="dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
          >
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={onFileInput} />
            <span className="drop-icon">+</span>
            <strong>Thả ảnh vào đây hoặc bấm để chọn</strong>
            <small>PNG, JPG, WEBP · Có thể chọn nhiều ảnh · Xử lý lần lượt để tránh hết quota</small>
          </label>

          {queue.length ? (
            <div className="queue-list">
              {queue.map((item) => (
                <article className="queue-item" key={item.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.preview} alt="" />
                  <div><strong>{item.file.name}</strong><span>{item.message}</span></div>
                  <span className={`queue-status ${item.status}`}>{item.status}</span>
                </article>
              ))}
              {queue.some((item) => item.status === 'waiting' || item.status === 'error') ? (
                <button
                  className="button button-dark"
                  disabled={busy}
                  onClick={() => void processItems(queue.filter((item) => item.status !== 'done' && item.status !== 'reading'))}
                >
                  {busy ? 'Đang đọc ảnh…' : 'Đọc ảnh đã chọn'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className="settings-panel">
          <div className="section-heading compact">
            <span className="section-number">AI</span>
            <div><p>Cấu hình miễn phí</p><h2>Gemini Vision</h2></div>
          </div>
          <label className="field">
            <span>Gemini API Key</span>
            <div className="key-field">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                placeholder="AIza…"
                onChange={(event) => setApiKey(event.target.value)}
              />
              <button type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? 'Ẩn' : 'Hiện'}</button>
            </div>
          </label>
          <label className="field">
            <span>Model</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} />
          </label>
          <label className="check-field">
            <input type="checkbox" checked={rememberKey} onChange={(event) => setRememberKey(event.target.checked)} />
            <span>Ghi nhớ key trên thiết bị này</span>
          </label>
          <button className="button button-outline" onClick={persistSettings}>Lưu cấu hình</button>
          <a className="text-link" href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">
            Tạo API Key miễn phí ↗
          </a>
          <div className="privacy-note">
            <strong>Ranh giới dữ liệu</strong>
            <p>Ảnh được gửi trực tiếp từ trình duyệt tới Google bằng key của bạn. Không tải ảnh có dữ liệu vượt phạm vi được phép chia sẻ.</p>
          </div>
          <div className="rule-note">
            <strong>Công thức đang áp dụng</strong>
            <code>Tổng phí = lot × 25 × phí USD/MT</code>
            <p>Đúng theo prompt mới. File Excel cũ có một số dòng dùng hệ số hai lượt; website sẽ không tự nhân đôi.</p>
          </div>
        </aside>
      </section>

      <section className="checks-band" aria-label="Ba lớp kiểm soát">
        <article><span>1</span><h3>Không đoán</h3><p>Ô không nhìn rõ được để trống và gắn cảnh báo.</p></article>
        <article><span>2</span><h3>Tính bằng quy tắc</h3><p>Tấn, phí và lợi nhuận sau phí không giao cho AI tự tính.</p></article>
        <article><span>3</span><h3>Duyệt trước khi copy</h3><p>Mọi trường AI đọc đều có thể chỉnh trực tiếp trong bảng.</p></article>
      </section>

      <section className="results-section" id="results">
        <div className="results-heading">
          <div className="section-heading">
            <span className="section-number">03</span>
            <div><p>Kết quả chuẩn hóa</p><h2>Rà soát theo từng tài khoản</h2></div>
          </div>
          {reports.length ? <button className="button button-dark" onClick={() => void copyAll()}>Copy toàn bộ Markdown</button> : null}
        </div>

        {!reports.length ? (
          <div className="empty-state">
            <span>SR</span>
            <div><h3>Chưa có bảng báo cáo</h3><p>Chọn tài khoản, nhập API Key và tải ảnh đầu tiên. Kết quả sẽ xuất hiện tại đây.</p></div>
          </div>
        ) : (
          <div className="report-stack">
            {reports.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                onCopy={copyReport}
                onAddPosition={addPosition}
                onAddTrade={addTrade}
                onPatchPosition={patchPosition}
                onPatchTrade={patchTrade}
                onRemovePosition={removePosition}
                onRemoveTrade={removeTrade}
                onClear={(reportId) => setReports((current) => current.filter((item) => item.id !== reportId))}
              />
            ))}
          </div>
        )}
      </section>

      <footer>
        <span>SIM REPORT / STAVIAN INDUSTRIAL METAL</span>
        <span>AI hỗ trợ trích xuất — người dùng chịu trách nhiệm đối soát trước khi hạch toán.</span>
      </footer>
    </main>
  );
}

type ReportCardProps = {
  report: AccountReport;
  onCopy: (report: AccountReport, type: 'markdown' | 'tsv') => Promise<void>;
  onAddPosition: (report: AccountReport) => void;
  onAddTrade: (report: AccountReport) => void;
  onPatchPosition: (reportId: string, rowId: string, patch: Partial<PositionRow>) => void;
  onPatchTrade: (reportId: string, rowId: string, patch: Partial<TradeRow>) => void;
  onRemovePosition: (reportId: string, rowId: string) => void;
  onRemoveTrade: (reportId: string, rowId: string) => void;
  onClear: (reportId: string) => void;
};

function ReportCard({
  report,
  onCopy,
  onAddPosition,
  onAddTrade,
  onPatchPosition,
  onPatchTrade,
  onRemovePosition,
  onRemoveTrade,
  onClear,
}: ReportCardProps) {
  const totalOte = report.positions.reduce((sum, row) => sum + (row.ote ?? 0), 0);
  const tradeTotals = report.trades.reduce(
    (sum, row) => {
      const calc = calculateTrade(row, report.fee);
      sum.fee += calc.totalFee;
      sum.before += row.plBeforeFee ?? 0;
      sum.after += calc.afterFee ?? 0;
      return sum;
    },
    { fee: 0, before: 0, after: 0 },
  );

  return (
    <article className="report-card">
      <header className="report-header">
        <div>
          <p>{report.accountName}</p>
          <h3>{report.accountCode}</h3>
          <span>{report.sourceFiles.length} ảnh nguồn · Phí {report.fee} USD/MT</span>
        </div>
        <div className="report-actions">
          <button className="button button-outline" onClick={() => void onCopy(report, 'markdown')}>Copy Markdown</button>
          <button className="button button-dark" onClick={() => void onCopy(report, 'tsv')}>Copy Google Sheet</button>
          <button className="icon-button" aria-label="Xóa báo cáo tài khoản" onClick={() => onClear(report.id)}>×</button>
        </div>
      </header>

      {report.warnings.length ? (
        <details className="warnings" open>
          <summary>{report.warnings.length} điểm cần rà soát</summary>
          <ul>{report.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
        </details>
      ) : null}

      <div className="table-section">
        <div className="table-title">
          <div><p>Vị thế đang có</p><span>Tổng OTE <b className={totalOte < 0 ? 'negative' : totalOte > 0 ? 'positive' : ''}>{formatNumber(totalOte)} USD</b></span></div>
          <button className="mini-button" onClick={() => onAddPosition(report)}>+ Thêm dòng</button>
        </div>
        {report.positions.length ? (
          <div className="table-scroll">
            <table className="data-table positions-table">
              <thead><tr>{POSITION_HEADERS.map((header) => <th key={header}>{header}</th>)}<th aria-label="Thao tác" /></tr></thead>
              <tbody>
                {report.positions.map((row) => (
                  <tr key={row.id} className={row.confidence !== null && row.confidence < 0.75 ? 'review-row' : ''}>
                    <EditableCell value={row.product} onChange={(value) => onPatchPosition(report.id, row.id, { product: value })} />
                    <EditableCell value={row.maturity} onChange={(value) => onPatchPosition(report.id, row.id, { maturity: value })} />
                    <EditableCell value={row.code} mono onChange={(value) => onPatchPosition(report.id, row.id, { code: value })} />
                    <EditableNumber value={row.buyPrice} onChange={(value) => onPatchPosition(report.id, row.id, { buyPrice: value })} />
                    <EditableNumber value={row.buyLots} lots onChange={(value) => onPatchPosition(report.id, row.id, { buyLots: value })} />
                    <EditableNumber value={row.sellPrice} onChange={(value) => onPatchPosition(report.id, row.id, { sellPrice: value })} />
                    <EditableNumber value={row.sellLots} lots onChange={(value) => onPatchPosition(report.id, row.id, { sellLots: value })} />
                    <EditableNumber value={row.ote} pnl onChange={(value) => onPatchPosition(report.id, row.id, { ote: value })} />
                    <td className="note-cell"><input value={row.note} onChange={(event) => onPatchPosition(report.id, row.id, { note: event.target.value })} /><small>{confidenceLabel(row.confidence)}</small></td>
                    <td><button className="row-delete" aria-label="Xóa dòng" onClick={() => onRemovePosition(report.id, row.id)}>×</button></td>
                  </tr>
                ))}
                <tr className="total-row"><td>Tổng OTE</td><td colSpan={6} /><td className={totalOte < 0 ? 'negative' : totalOte > 0 ? 'positive' : ''}>{formatNumber(totalOte)}</td><td /><td /></tr>
              </tbody>
            </table>
          </div>
        ) : <p className="table-empty">Chưa đọc được vị thế từ ảnh này.</p>}
      </div>

      <div className="table-section">
        <div className="table-title">
          <div><p>Hạch toán lợi nhuận giao dịch</p><span>Sau phí <b className={tradeTotals.after < 0 ? 'negative' : tradeTotals.after > 0 ? 'positive' : ''}>{formatNumber(tradeTotals.after)} USD</b></span></div>
          <button className="mini-button" onClick={() => onAddTrade(report)}>+ Thêm dòng</button>
        </div>
        {report.noTrades && !report.trades.length ? (
          <div className="no-trades">Không có phát sinh hạch toán giao dịch.</div>
        ) : report.trades.length ? (
          <div className="table-scroll">
            <table className="data-table trades-table">
              <thead><tr>{TRADE_HEADERS.map((header) => <th key={header}>{header}</th>)}<th aria-label="Thao tác" /></tr></thead>
              <tbody>
                {report.trades.map((row, index) => {
                  const calc = calculateTrade(row, report.fee);
                  return (
                    <tr key={row.id} className={row.confidence !== null && row.confidence < 0.75 ? 'review-row' : ''}>
                      <td>{index + 1}</td>
                      <EditableCell value={row.executor} onChange={(value) => onPatchTrade(report.id, row.id, { executor: value })} />
                      <EditableCell value={row.openDate} mono onChange={(value) => onPatchTrade(report.id, row.id, { openDate: value })} />
                      <EditableCell value={row.closeDate} mono onChange={(value) => onPatchTrade(report.id, row.id, { closeDate: value })} />
                      <EditableCell value={row.maturityDate} mono onChange={(value) => onPatchTrade(report.id, row.id, { maturityDate: value })} />
                      <EditableCell value={row.code} mono onChange={(value) => onPatchTrade(report.id, row.id, { code: value })} />
                      <td className="derived-cell">{productFromCode(row.code)}</td>
                      <td><select value={row.side} onChange={(event) => onPatchTrade(report.id, row.id, { side: event.target.value as TradeRow['side'] })}><option value="" /><option value="Long">Long</option><option value="Short">Short</option></select></td>
                      <EditableNumber value={row.openPrice} onChange={(value) => onPatchTrade(report.id, row.id, { openPrice: value })} />
                      <EditableNumber value={row.closePrice} onChange={(value) => onPatchTrade(report.id, row.id, { closePrice: value })} />
                      <EditableNumber value={row.lots} lots onChange={(value) => onPatchTrade(report.id, row.id, { lots: value })} />
                      <td className="derived-cell">{formatLots(calc.tons)}</td>
                      <td className="derived-cell">{report.fee}</td>
                      <td className="derived-cell">{formatNumber(calc.totalFee)}</td>
                      <EditableNumber value={row.carry} onChange={(value) => onPatchTrade(report.id, row.id, { carry: value })} />
                      <EditableNumber value={row.plBeforeFee} pnl onChange={(value) => onPatchTrade(report.id, row.id, { plBeforeFee: value })} />
                      <td className={`derived-cell ${calc.afterFee !== null && calc.afterFee < 0 ? 'negative' : calc.afterFee !== null && calc.afterFee > 0 ? 'positive' : ''}`}>{formatNumber(calc.afterFee)}<small>{confidenceLabel(row.confidence)}</small></td>
                      <td><button className="row-delete" aria-label="Xóa dòng" onClick={() => onRemoveTrade(report.id, row.id)}>×</button></td>
                    </tr>
                  );
                })}
                <tr className="total-row"><td>Tổng</td><td colSpan={12} /><td>{formatNumber(tradeTotals.fee)}</td><td /><td className={tradeTotals.before < 0 ? 'negative' : tradeTotals.before > 0 ? 'positive' : ''}>{formatNumber(tradeTotals.before)}</td><td className={tradeTotals.after < 0 ? 'negative' : tradeTotals.after > 0 ? 'positive' : ''}>{formatNumber(tradeTotals.after)}</td><td /></tr>
              </tbody>
            </table>
          </div>
        ) : <p className="table-empty">Chưa đọc được hạch toán từ ảnh này.</p>}
      </div>
    </article>
  );
}

function EditableCell({ value, onChange, mono = false }: { value: string; onChange: (value: string) => void; mono?: boolean }) {
  return <td><input className={mono ? 'mono' : ''} value={value} onChange={(event) => onChange(event.target.value)} /></td>;
}

function EditableNumber({ value, onChange, lots = false, pnl = false }: { value: number | null; onChange: (value: number | null) => void; lots?: boolean; pnl?: boolean }) {
  return (
    <td className={value !== null && value < 0 ? 'negative' : value !== null && value > 0 && pnl ? 'positive' : ''}>
      <input
        className="mono numeric"
        inputMode="decimal"
        value={lots ? formatLots(value) : formatNumber(value)}
        onChange={(event) => onChange(parseImageNumber(event.target.value, pnl ? 'pnl' : 'regular'))}
      />
    </td>
  );
}

