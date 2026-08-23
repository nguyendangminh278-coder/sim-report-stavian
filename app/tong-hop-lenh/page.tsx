import '../report-upgrade.css';
import '../unified-dashboard.css';
import UnifiedDashboard from '../unified-dashboard';

export const dynamic = 'force-static';

export default function MonthlyLegacyRoute() {
  return <UnifiedDashboard initialTab="tong-hop-lenh" />;
}
