import Link from 'next/link';
import './report-upgrade.css';
import './tool-navigation.css';
import WorkspaceV2 from './workspace-v2';

export default function Home() {
  return (
    <>
      <nav className="tool-hub-nav" aria-label="Công cụ báo cáo">
        <Link className="active" href="/">Đọc ảnh</Link>
        <Link href="/tong-hop-lenh">Tổng hợp lệnh</Link>
        <Link href="/bao-cao-tuan">Báo cáo tuần</Link>
      </nav>
      <WorkspaceV2 />
    </>
  );
}
