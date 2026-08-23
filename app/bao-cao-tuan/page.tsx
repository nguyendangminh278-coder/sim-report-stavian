import '../report-upgrade.css';
import '../unified-dashboard.css';
import UnifiedDashboard from '../unified-dashboard';

export const dynamic = 'force-static';

export default function WeeklyLegacyRoute() {
  return <UnifiedDashboard initialTab="bao-cao-tuan" />;
}
