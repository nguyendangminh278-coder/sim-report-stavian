import './report-upgrade.css';
import './unified-dashboard.css';
import UnifiedDashboard, { type UnifiedTabId } from './unified-dashboard';

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function normalizeTab(value: string | string[] | undefined): UnifiedTabId {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === 'tong-hop-lenh' || candidate === 'bao-cao-tuan') return candidate;
  return 'doc-anh';
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  return <UnifiedDashboard initialTab={normalizeTab(params.tab)} />;
}
