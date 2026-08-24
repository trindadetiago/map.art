import { env } from '@mapart/env';
import { AnalyticsPanel } from './panel';

export default function AnalyticsPage() {
  return (
    <div>
      <h1 className="mt-0">analytics</h1>
      <AnalyticsPanel token={env.posthogDashboardToken} />
    </div>
  );
}
