import type { Metadata } from 'next';
import { Be_Vietnam_Pro, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

export const dynamic = 'force-static';

const sans = Be_Vietnam_Pro({
  variable: '--font-sans',
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
});

const mono = IBM_Plex_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'SIM Report — Đọc ảnh giao dịch LME',
  description:
    'Công cụ AI đọc ảnh vị thế và hạch toán LME, chuẩn hóa dữ liệu để đối soát và copy vào Google Sheet.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body className={`${sans.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}

