import '../report-upgrade.css';
import '../unified-dashboard.css';
import UnifiedDashboard from '../unified-dashboard';

export const dynamic = 'force-static';

export default function NewsLegacyRoute() {
  return <UnifiedDashboard initialTab="tin-tuc" />;
}
