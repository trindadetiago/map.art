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
} as const satisfies Record<string, EnvFieldDef>;

export type EnvKey = keyof typeof SCHEMA;
