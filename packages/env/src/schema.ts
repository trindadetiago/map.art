export interface EnvFieldDef {
  /** The `KEY` name in .env / process.env. */
  envKey: string;
  /** Short human-readable description, used by the debug panel. */
  description: string;
  /** Required means the `env` getter will throw when missing AND when validated. Most fields should be optional; use `requireEnv(...)` at call-sites that actually need them. */
  required?: boolean;
  /** Fallback when the env var is missing or empty. */
  default?: string;
  /** Optional validator; receives the raw string, throws to reject, returns the accepted string (can normalize). */
  validate?: (value: string) => string;
}

export const SCHEMA = {
  googleMapsApiKey: {
    envKey: 'GOOGLE_MAPS_API_KEY',
    description: 'Google Maps Platform key with Map Tiles API enabled. Used by the renderer.',
  },
  openaiApiKey: {
    envKey: 'OPENAI_API_KEY',
    description: 'OpenAI API key for gpt-image-1 (image-to-image editing).',
  },
  oxenApiKey: {
    envKey: 'OXEN_API_KEY',
    description:
      'oxen.ai API key for pushing training bundles to hub.oxen.ai and dedicated LoRA inference. When set, worker-stylize runs the deployed model instead of the pass-through stub.',
  },
  databaseUrl: {
    envKey: 'DATABASE_URL',
    description: 'Postgres connection string. Optional until DB work starts.',
    validate: (v) => {
      if (!v.startsWith('postgres://') && !v.startsWith('postgresql://')) {
        throw new Error('DATABASE_URL must start with postgres:// or postgresql://');
      }
      return v;
    },
  },
  s3Endpoint: {
    envKey: 'S3_ENDPOINT',
    description:
      'S3 endpoint URL. Set for MinIO (e.g. http://localhost:9000); leave empty for AWS S3.',
  },
  s3Region: {
    envKey: 'S3_REGION',
    description: 'S3 region. MinIO accepts anything; AWS uses real region codes.',
    default: 'us-east-1',
  },
  s3AccessKeyId: {
    envKey: 'S3_ACCESS_KEY_ID',
    description: 'S3 access key id. Required for blob storage.',
  },
  s3SecretAccessKey: {
    envKey: 'S3_SECRET_ACCESS_KEY',
    description: 'S3 secret access key. Required for blob storage.',
  },
  s3Bucket: {
    envKey: 'S3_BUCKET',
    description: 'S3 bucket name. Required for blob storage.',
  },
  railwayApiToken: {
    envKey: 'RAILWAY_API_TOKEN',
    description:
      'Railway account token, used by apps/web to trigger an export on the export-runner service. Leave empty and the admin export button reports itself as unavailable instead of failing at click time.',
  },
  railwayProjectId: {
    envKey: 'RAILWAY_PROJECT_ID',
    description: 'Railway project the export-runner lives in. Injected automatically on Railway.',
  },
  railwayEnvironmentId: {
    envKey: 'RAILWAY_ENVIRONMENT_ID',
    description:
      'Railway environment to deploy the export-runner into. Injected automatically on Railway.',
  },
  exportRunnerService: {
    envKey: 'EXPORT_RUNNER_SERVICE',
    description: 'Name of the Railway service that runs exports.',
    default: 'export-runner',
  },
  vizS3Endpoint: {
    envKey: 'VIZ_S3_ENDPOINT',
    description:
      'S3 endpoint for the bucket holding published pyramids (the one served publicly). Leave the whole VIZ_S3_* group empty to keep pyramids in the main bucket.',
  },
  vizS3Region: {
    envKey: 'VIZ_S3_REGION',
    description: 'Region for the published-pyramid bucket.',
    default: 'auto',
  },
  vizS3AccessKeyId: {
    envKey: 'VIZ_S3_ACCESS_KEY_ID',
    description: 'Access key id for the published-pyramid bucket.',
  },
  vizS3SecretAccessKey: {
    envKey: 'VIZ_S3_SECRET_ACCESS_KEY',
    description: 'Secret access key for the published-pyramid bucket.',
  },
  vizS3Bucket: {
    envKey: 'VIZ_S3_BUCKET',
    description:
      'Bucket name for published pyramids. Setting this is what splits them out of the main bucket; unset, everything shares one.',
  },
  vizPublicBaseUrl: {
    envKey: 'VIZ_PUBLIC_BASE_URL',
    description:
      "Origin serving the visualizer's pyramid objects directly from the bucket (e.g. https://tiles.example.com), CDN in front. Set it and the viewer requests tiles straight from there; leave empty and it falls back to the visualizer's own proxy route.",
    validate: (v) => {
      if (!v.startsWith('http://') && !v.startsWith('https://')) {
        throw new Error('VIZ_PUBLIC_BASE_URL must be an absolute http(s) URL');
      }
      return v.replace(/\/+$/, '');
    },
  },
  stylizeDebugArtifacts: {
    envKey: 'STYLIZE_DEBUG_ARTIFACTS',
    description:
      'Set to "1" to make worker-stylize persist per-tile pipeline artifacts (model composite + raw output) to storage for inspection. Off by default — they double the upload volume per tile.',
  },
  appPassword: {
    envKey: 'APP_PASSWORD',
    description:
      'Shared password gating the whole apps/web site. When set, visitors must enter it at /login before any page loads; leave empty to disable the gate (e.g. local dev).',
  },
  posthogKey: {
    envKey: 'POSTHOG_KEY',
    description:
      'PostHog project API key (the public "Project API Key", safe to ship to the browser). Read by the Next apps\' root layouts and handed to @mapart/ui/analytics. Leave empty to disable analytics.',
  },
  posthogDashboardToken: {
    envKey: 'POSTHOG_DASHBOARD_TOKEN',
    description:
      'Share token of a PostHog dashboard with sharing enabled, embedded by /admin/analytics. Distinct from POSTHOG_KEY. Anyone holding it can read that dashboard without logging in. Leave empty to show the setup instructions instead.',
  },
  railwayEnvironmentName: {
    envKey: 'RAILWAY_ENVIRONMENT_NAME',
    description:
      'Injected automatically by Railway (e.g. "production"). Presence signals the process runs on Railway; leave unset locally.',
  },
  renderWorkerPort: {
    envKey: 'RENDER_WORKER_PORT',
    description:
      'Port apps/worker-render listens on. Serves the render-page on GET / (via embedded Vite in dev) and the render API on POST /render. Puppeteer also navigates to this same port internally.',
    default: '9999',
  },
  logLevel: {
    envKey: 'LOG_LEVEL',
    description:
      'Minimum log level emitted by @mapart/logger: debug, info, warn, or error. Defaults to info on Railway and debug locally.',
    validate: (v) => {
      const allowed = ['debug', 'info', 'warn', 'error'];
      if (!allowed.includes(v.toLowerCase())) {
        throw new Error(`LOG_LEVEL must be one of ${allowed.join(', ')}`);
      }
      return v.toLowerCase();
    },
  },
  logFormat: {
    envKey: 'LOG_FORMAT',
    description:
      'Log line format from @mapart/logger: "pretty" (human-readable, coloured on a TTY) or "json" (one JSON object per line). Defaults to json on Railway and pretty locally.',
    validate: (v) => {
      if (v.toLowerCase() !== 'pretty' && v.toLowerCase() !== 'json') {
        throw new Error('LOG_FORMAT must be "pretty" or "json"');
      }
      return v.toLowerCase();
    },
  },
} as const satisfies Record<string, EnvFieldDef>;

export type EnvKey = keyof typeof SCHEMA;
