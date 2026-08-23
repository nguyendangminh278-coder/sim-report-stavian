'use client';

import { useEffect, useState } from 'react';
import { PROMPT_TEMPLATES } from './prompt-content';
import './prompt-library.css';

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Trình duyệt không cho phép sao chép tự động.');
}

export default function PromptLibrary() {
  const [copiedId, setCopiedId] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(''), 2600);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const handleCopy = async (id: string, title: string, content: string) => {
    try {
      await copyText(content);
      setCopiedId(id);
      setMessage(`Đã sao chép toàn bộ prompt “${title}”.`);
      window.setTimeout(() => setCopiedId((current) => current === id ? '' : current), 2200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể sao chép prompt.');
    }
  };

  return (
    <main className="prompt-page">
      <section className="prompt-hero">
        <div className="prompt-hero-copy">
          <p className="prompt-kicker">SIM Prompt Library · 03 quy trình chuẩn</p>
          <h1>Mang nghiệp vụ<br />sang ChatGPT.</h1>
          <p className="prompt-lead">
            Sao chép một bộ chỉ dẫn hoàn chỉnh để dùng ngay trong cuộc trò chuyện hoặc đặt vào Instructions của GPT tùy chỉnh khi tài khoản của bạn có quyền tạo.
          </p>
        </div>
        <aside className="prompt-quick-guide" aria-label="Cách sử dụng prompt">
          <p>Cách dùng nhanh</p>
          <ol>
            <li><span>01</span><b>Chọn đúng nghiệp vụ</b></li>
            <li><span>02</span><b>Sao chép toàn bộ prompt</b></li>
            <li><span>03</span><b>Dán vào ChatGPT hoặc Instructions</b></li>
            <li><span>04</span><b>Đính kèm ảnh/file mẫu khi chạy</b></li>
          </ol>
        </aside>
      </section>

      <section className="prompt-access-note" aria-label="Lưu ý quyền tạo GPT">
        <span aria-hidden="true">i</span>
        <div>
          <strong>Nếu không thấy nút tạo GPT</strong>
          <p>Quyền tạo và xuất bản GPT phụ thuộc gói, loại tài khoản và workspace tại từng thời điểm. Bạn vẫn có thể dán nguyên prompt vào đầu một cuộc trò chuyện mới rồi tải ảnh hoặc Excel lên để sử dụng.</p>
        </div>
      </section>

      <section className="prompt-catalog" aria-labelledby="prompt-catalog-title">
        <header className="prompt-section-heading">
          <div>
            <p>Thư viện dùng chung</p>
            <h2 id="prompt-catalog-title">Ba trợ lý cho phòng phái sinh</h2>
          </div>
          <span>Không cần API · Sao chép miễn phí</span>
        </header>

        <div className="prompt-grid">
          {PROMPT_TEMPLATES.map((template) => (
            <article className="prompt-card" key={template.id} id={`prompt-${template.id}`}>
              <div className="prompt-card-number" aria-hidden="true">{template.number}</div>
              <div className="prompt-card-main">
                <p className="prompt-card-category">{template.category}</p>
                <h3>{template.title}</h3>
                <p className="prompt-card-description">{template.description}</p>

                <div className="prompt-capabilities" aria-label="Khả năng nên bật">
                  {template.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
                </div>

                <div className="prompt-setup-note">
                  <strong>Thiết lập đề xuất</strong>
                  <p>{template.setupNote}</p>
                </div>

                <div className="prompt-card-actions">
                  <button
                    className="prompt-copy-button"
                    type="button"
                    onClick={() => handleCopy(template.id, template.title, template.content)}
                  >
                    <span aria-hidden="true">{copiedId === template.id ? '✓' : '＋'}</span>
                    {copiedId === template.id ? 'Đã sao chép' : 'Sao chép toàn bộ'}
                  </button>
                  <details className="prompt-preview">
                    <summary>Xem nội dung</summary>
                    <div className="prompt-preview-inner">
                      <div className="prompt-preview-bar">
                        <span>Instructions · {template.content.length.toLocaleString('vi-VN')} ký tự</span>
                        <button type="button" onClick={() => handleCopy(template.id, template.title, template.content)}>Sao chép</button>
                      </div>
                      <pre>{template.content}</pre>
                    </div>
                  </details>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="prompt-footer-note">
        <p>Mẹo vận hành</p>
        <h2>Giữ prompt làm quy tắc.<br />Giữ file mẫu làm chuẩn.</h2>
        <div>
          <p>Không đưa API key, mật khẩu hoặc dữ liệu đăng nhập vào Instructions hay file Knowledge.</p>
          <p>Với báo cáo Excel, luôn kiểm tra số lệnh, tổng P&amp;L và sheet “Kiểm tra lệch” trước khi sử dụng.</p>
        </div>
      </section>

      {message && <div className="prompt-toast" role="status" aria-live="polite">{message}</div>}
    </main>
  );
}
