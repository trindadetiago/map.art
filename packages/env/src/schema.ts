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
  geminiApiKey: {
    envKey: 'GEMINI_API_KEY',
    description: 'Google AI Studio key for Gemini 2.5 Flash Image (nano-banana).',
  },
  openaiApiKey: {
    envKey: 'OPENAI_API_KEY',
    description: 'OpenAI API key for gpt-image-1 (image-to-image editing).',
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
  storageBackend: {
    envKey: 'STORAGE_BACKEND',
    description: 'Storage driver. "s3" uses S3/MinIO, "local" uses the on-disk data/ folder.',
    default: 'local',
    validate: (v) => {
      if (v !== 's3' && v !== 'local') {
        throw new Error('STORAGE_BACKEND must be "s3" or "local"');
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
    description: 'S3 access key id. Required when STORAGE_BACKEND=s3.',
  },
  s3SecretAccessKey: {
    envKey: 'S3_SECRET_ACCESS_KEY',
    description: 'S3 secret access key. Required when STORAGE_BACKEND=s3.',
  },
  s3Bucket: {
    envKey: 'S3_BUCKET',
    description: 'S3 bucket name. Required when STORAGE_BACKEND=s3.',
  },
  s3ForcePathStyle: {
    envKey: 'S3_FORCE_PATH_STYLE',
    description:
      'Use path-style S3 URLs (bucket in path, not subdomain). Required "true" for MinIO.',
    default: 'false',
  },
} as const satisfies Record<string, EnvFieldDef>;

export type EnvKey = keyof typeof SCHEMA;
