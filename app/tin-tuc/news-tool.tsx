'use client';

import { ReactNode, useState } from 'react';
import {
  generateDailyNewsReport,
  generateLatestReutersUpdate,
  type GroundedNewsResult,
} from '../lib/news-report.ts';
import './news-report.css';

function bangkokIsoDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function previousIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function cleanUrl(value: string) {
  return value.replace(/[.,;:]+$/, '');
}

function renderInlineMarkup(line: string): ReactNode[] {
  return line.split(/(<b>.*?<\/b>|https?:\/\/[^\s<>]+)/g).filter(Boolean).map((part, index) => {
    const bold = part.match(/^<b>(.*?)<\/b>$/);
    if (bold) return <strong key={`${part}-${index}`}>{bold[1]}</strong>;
    if (/^https?:\/\//.test(part)) {
      const uri = cleanUrl(part);
      const suffix = part.slice(uri.length);
      return (
        <span key={`${part}-${index}`}>
          <a href={uri} target="_blank" rel="noreferrer">{uri}</a>{suffix}
        </span>
      );
    }
    return part;
  });
}

function ReportBody({ text }: { text: string }) {
  return (
    <div className="news-report-body">
      {text.split(/\r?\n/).map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return <div className="news-spacer" key={`space-${index}`} aria-hidden="true" />;
        const title = line.match(/^\[TITLE\](.*?)\[\/TITLE\]$/i);
        if (title) return <h2 key={`title-${index}`}>{title[1]}</h2>;
        if (/^-{3,}$/.test(line)) return <hr key={`rule-${index}`} />;
        if (/^Nguồn(?: tin| link cho toàn bộ)?:?$/i.test(line)) {
          return <h3 key={`source-${index}`}>{line}</h3>;
        }
        if (/^(?:\*|-|•)\s+/.test(line)) {
          return <p className="news-bullet" key={`bullet-${index}`}>{renderInlineMarkup(line.replace(/^(?:\*|-|•)\s+/, ''))}</p>;
        }
        return <p key={`line-${index}`}>{renderInlineMarkup(line)}</p>;
      })}
    </div>
  );
}

function ResultPanel({ result, onCopy }: { result: GroundedNewsResult; onCopy: () => void }) {
  const generatedAt = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(result.generatedAt));

  return (
    <section className="news-result-card" aria-labelledby="news-result-title">
      <div className="news-result-heading">
        <div>
          <span>BÁO CÁO ĐÃ GROUNDING</span>
          <h1 id="news-result-title">Kết quả phân tích</h1>
          <p>Tạo lúc {generatedAt} · {result.sources.length} nguồn xác nhận</p>
        </div>
        <button type="button" onClick={onCopy}>Sao chép báo cáo</button>
      </div>

      {!result.usedTimeFilter && (
        <div className="news-notice warning">
          Model hiện tại không nhận bộ lọc ngày ở cấp API; hệ thống đã tìm lại bằng Google Search và khóa ngày nghiêm ngặt trong prompt.
        </div>
      )}

      <ReportBody text={result.text} />

      {!!result.sources.length && (
        <div className="news-sources">
          <div>
            <span>ĐỐI CHIẾU NGUỒN</span>
            <h2>Nguồn Gemini đã sử dụng</h2>
          </div>
          <ol>
            {result.sources.map((source) => (
              <li key={source.uri}>
                <a href={source.uri} target="_blank" rel="noreferrer">
                  <strong>{source.title}</strong>
                  <small>{source.uri}</small>
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}

      {!!result.queries.length && (
        <details className="news-queries">
          <summary>Truy vấn Google Search đã dùng</summary>
          <ul>{result.queries.map((query) => <li key={query}>{query}</li>)}</ul>
        </details>
      )}

      {result.searchEntryPointHtml && (
        <iframe
          className="news-search-entry"
          title="Gợi ý tìm kiếm của Google"
          srcDoc={result.searchEntryPointHtml}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
        />
      )}
    </section>
  );
}

export default function NewsTool({ onOpenSettings }: { onOpenSettings: () => void }) {
  const today = bangkokIsoDate();
  const [fromDate, setFromDate] = useState(previousIsoDate(today));
  const [toDate, setToDate] = useState(today);
  const [includeEconomicCalendar, setIncludeEconomicCalendar] = useState(true);
  const [activeRequest, setActiveRequest] = useState<'daily' | 'latest' | null>(null);
  const [result, setResult] = useState<GroundedNewsResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const runDailyReport = async () => {
    setError('');
    setNotice('');
    setActiveRequest('daily');
    try {
      setResult(await generateDailyNewsReport(fromDate, toDate, includeEconomicCalendar));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không thể tạo báo cáo tin tức.');
    } finally {
      setActiveRequest(null);
    }
  };

  const runLatestReuters = async () => {
    setError('');
    setNotice('');
    setActiveRequest('latest');
    try {
      setResult(await generateLatestReutersUpdate());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không thể cập nhật Reuters.');
    } finally {
      setActiveRequest(null);
    }
  };

  const copyReport = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setNotice('Đã sao chép toàn bộ báo cáo.');
      window.setTimeout(() => setNotice(''), 1800);
    } catch {
      setError('Trình duyệt không cho phép sao chép. Hãy chọn nội dung và nhấn Ctrl/Cmd+C.');
    }
  };

  const isLoading = activeRequest !== null;

  return (
    <main className="news-page">
      <section className="news-hero">
        <div>
          <span className="news-eyebrow">LME INTELLIGENCE · GOOGLE SEARCH GROUNDING</span>
          <h1>Tin tức AI cho desk kim loại</h1>
          <p>
            Chọn khoảng ngày, Gemini tự tìm nguồn, kiểm tra mốc thời gian và đánh giá tác động lên Đồng, Nhôm, Kẽm.
            Không có nguồn grounding thì website không xuất báo cáo.
          </p>
        </div>
        <div className="news-live-card">
          <span className="news-live-dot" aria-hidden="true" />
          <div><strong>Tìm kiếm web thời gian thực</strong><small>Dùng API Key và model đã lưu trên trình duyệt</small></div>
        </div>
      </section>

      <section className="news-command-grid" aria-label="Điều khiển tìm kiếm tin tức">
        <article className="news-command-card primary">
          <div className="news-card-index">01</div>
          <div className="news-card-copy">
            <span>BÁO CÁO THEO KHOẢNG NGÀY</span>
            <h2>Đồng · Nhôm · Kẽm LME</h2>
            <p>Gemini tìm giá, tin vĩ mô, tin ngành và nguồn chính thức trong đúng khoảng thời gian đã chọn.</p>
          </div>

          <div className="news-date-grid">
            <label>
              <span>Từ ngày</span>
              <input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} />
            </label>
            <label>
              <span>Đến ngày</span>
              <input type="date" value={toDate} min={fromDate} max={today} onChange={(event) => setToDate(event.target.value)} />
            </label>
          </div>

          <label className="news-calendar-check">
            <input
              type="checkbox"
              checked={includeEconomicCalendar}
              onChange={(event) => setIncludeEconomicCalendar(event.target.checked)}
            />
            <span><strong>Kèm lịch kinh tế</strong><small>Thực tế · dự báo · kỳ trước · giờ công bố Việt Nam</small></span>
          </label>

          <button className="news-run-button" type="button" onClick={() => void runDailyReport()} disabled={isLoading}>
            {activeRequest === 'daily' ? 'Gemini đang tìm và đánh giá…' : 'Tìm kiếm & tạo báo cáo'}
          </button>
        </article>

        <article className="news-command-card urgent">
          <div className="news-card-index">02</div>
          <div className="news-card-copy">
            <span>QUÉT NHANH REUTERS</span>
            <h2>Tin quan trọng mới nhất</h2>
            <p>
              Một lần bấm để tìm Reuters gần hiện tại nhất trong 72 giờ qua, chỉ giữ tin ảnh hưởng trực tiếp đến giá LME.
            </p>
          </div>

          <div className="news-priority-list">
            <span><b>01</b> Thời gian xuất bản gần nhất</span>
            <span><b>02</b> Nguồn Reuters xác nhận</span>
            <span><b>03</b> Tác động giao dịch rõ ràng</span>
          </div>

          <button className="news-urgent-button" type="button" onClick={() => void runLatestReuters()} disabled={isLoading}>
            {activeRequest === 'latest' ? 'Đang quét Reuters…' : 'Cập nhật tin quan trọng'}
          </button>
          <small className="news-speed-note">Ưu tiên tốc độ và độ chính xác; bỏ qua tin thứ yếu.</small>
        </article>
      </section>

      <section className="news-api-strip">
        <span>AI</span>
        <p>Chức năng này dùng Gemini API Key đã lưu ở phần Đọc ảnh.</p>
        <button type="button" onClick={onOpenSettings}>Mở cấu hình API</button>
      </section>

      {error && <div className="news-notice error" role="alert">{error}</div>}
      {activeRequest && (
        <div className="news-loading" role="status" aria-live="polite">
          <span aria-hidden="true" />
          <div>
            <strong>{activeRequest === 'latest' ? 'Đang tìm Reuters mới nhất' : 'Đang đối chiếu giá, tin tức và nguồn'}</strong>
            <small>Gemini đang sử dụng Google Search grounding. Vui lòng giữ trang mở.</small>
          </div>
        </div>
      )}

      {result && <ResultPanel result={result} onCopy={() => void copyReport()} />}
      {notice && <div className="news-toast" role="status">{notice}</div>}
    </main>
  );
}
