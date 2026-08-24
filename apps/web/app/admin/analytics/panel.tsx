/** Embed host for a PostHog dashboard. */
const EMBED_ORIGIN = 'https://us.posthog.com';

export function AnalyticsPanel({ token }: { token: string | undefined }) {
  if (!token) {
    return <SetupInstructions />;
  }

  return (
    <div>
      <p className="max-w-[640px] opacity-70">
        Read-only embed of the shared PostHog dashboard behind <code>POSTHOG_DASHBOARD_TOKEN</code>.
        Edit the dashboard itself in PostHog — the changes show up here on the next load.
      </p>
      <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white">
        <iframe
          src={`${EMBED_ORIGIN}/embedded/${encodeURIComponent(token)}`}
          title="PostHog dashboard"
          className="block h-[calc(100vh-260px)] min-h-[520px] w-full border-0"
        />
      </div>
    </div>
  );
}

function SetupInstructions() {
  return (
    <div>
      <p className="max-w-[640px] opacity-70">
        No <code>POSTHOG_DASHBOARD_TOKEN</code> set, so there is nothing to embed yet. PostHog only
        allows framing its <em>shared</em> dashboards — the signed-in app sends{' '}
        <code>X-Frame-Options: SAMEORIGIN</code>, so a plain dashboard URL will not render here.
      </p>
      <ol className="max-w-[640px] space-y-2 pl-5 text-sm text-stone-600">
        <li>Open the dashboard you want in PostHog.</li>
        <li>
          Use the <code>⋯</code> menu → <strong>Share</strong> → enable sharing.
        </li>
        <li>Copy the last path segment of the share URL — that is the token, not the whole URL.</li>
        <li>
          Put it in <code>.env</code> as <code>POSTHOG_DASHBOARD_TOKEN</code> and restart the dev
          server.
        </li>
      </ol>
      <p className="mt-6 max-w-[640px] rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        A shared dashboard is readable by anyone holding the token, with no login. Only share
        dashboards whose contents you are willing to expose that way.
      </p>
    </div>
  );
}
