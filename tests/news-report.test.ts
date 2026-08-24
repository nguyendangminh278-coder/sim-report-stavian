import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyNewsPrompt,
  buildLatestReutersPrompt,
  validateNewsDateRange,
} from '../app/lib/news-report.ts';

test('kiểm tra khoảng ngày tin tức', () => {
  assert.match(validateNewsDateRange('', '2026-08-24'), /đầy đủ/i);
  assert.match(validateNewsDateRange('2026-08-25', '2026-08-24'), /không được sau/i);
  assert.match(validateNewsDateRange('2026-07-01', '2026-08-24'), /tối đa 31 ngày/i);
  assert.equal(validateNewsDateRange('2026-08-20', '2026-08-24'), '');
});

test('prompt báo cáo khóa đúng ngày và tùy chọn lịch kinh tế', () => {
  const withCalendar = buildDailyNewsPrompt('2026-08-20', '2026-08-24', true);
  assert.match(withCalendar, /20–24\/08\/2026/);
  assert.match(withCalendar, /CHỈ SỐ KINH TẾ ẢNH HƯỞNG ĐẾN LME/);
  assert.match(withCalendar, /Không dùng tin sau 24\/08\/2026/);
  assert.match(withCalendar, /Reuters/);
  assert.match(withCalendar, /Đồng → Nhôm → Kẽm → Chỉ số kinh tế/);
  assert.match(withCalendar, /Tên nguồn – nội dung/);

  const withoutCalendar = buildDailyNewsPrompt('2026-08-24', '2026-08-24', false);
  assert.doesNotMatch(withoutCalendar, /\[TITLE\]CHỈ SỐ KINH TẾ/);
  assert.match(withoutCalendar, /Không thêm phần lịch\/chỉ số kinh tế riêng/);
});

test('prompt cập nhật nhanh bắt buộc Reuters và giới hạn 72 giờ', () => {
  const prompt = buildLatestReutersPrompt(new Date('2026-08-24T03:00:00.000Z'));
  assert.match(prompt, /72 giờ gần nhất/);
  assert.match(prompt, /reuters\.com/);
  assert.match(prompt, /Tối đa 3 truy vấn/);
  assert.match(prompt, /Markdown table đúng 3 cột/);
  assert.match(prompt, /Kết luận giao dịch theo tin Reuters/);
  assert.match(prompt, /KHÔNG DÙNG THẺ \[TITLE\]/);
});
