import { loadRootEnv } from './loader';
import { type EnvFieldDef, type EnvKey, SCHEMA } from './schema';

// Side-effect on import: populate process.env from the root .env file.
loadRootEnv();

type Resolved<K extends EnvKey> = (typeof SCHEMA)[K] extends { default: string }
  ? string
  : string | undefined;

type EnvShape = { [K in EnvKey]: Resolved<K> };

function resolveField(def: EnvFieldDef): string | undefined {
  const raw = process.env[def.envKey];
  const value = raw && raw.length > 0 ? raw : def.default;
  if (value === undefined) {
    if (def.required) {
      throw new Error(`[@mapart/env] required env var missing: ${def.envKey}`);
    }
    return undefined;
  }
  if (def.validate) {
    try {
      return def.validate(value);
    } catch (err) {
      throw new Error(
        `[@mapart/env] invalid value for ${def.envKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return value;
}

function build(): EnvShape {
  const out: Record<string, string | undefined> = {};
  for (const [key, def] of Object.entries(SCHEMA) as [EnvKey, EnvFieldDef][]) {
    out[key] = resolveField(def);
  }
  return out as EnvShape;
}

/** Typed, validated view of the environment. Fails fast on invalid values at load time. */
export const env: EnvShape = build();

/** Throws a descriptive error if the env var is missing. Use at call-sites that actually need the value. */
export function requireEnv<K extends EnvKey>(key: K): NonNullable<EnvShape[K]> {
  const v = env[key];
  if (v === undefined || v === '') {
    const def = SCHEMA[key];
    throw new Error(`[@mapart/env] required env var missing: ${def.envKey} — ${def.description}`);
  }
  return v as NonNullable<EnvShape[K]>;
}

export interface EnvStatusEntry {
  key: EnvKey;
  envKey: string;
  description: string;
  isSet: boolean;
  usingDefault: boolean;
}

/** Non-secret summary of env state. Never returns the actual values — safe to show in UI. */
export function getEnvStatus(): EnvStatusEntry[] {
  return (Object.keys(SCHEMA) as EnvKey[]).map((key) => {
    const def = SCHEMA[key] as EnvFieldDef;
    const raw = process.env[def.envKey];
    const rawIsSet = raw !== undefined && raw !== '';
    return {
      key,
      envKey: def.envKey,
      description: def.description,
      isSet: rawIsSet || def.default !== undefined,
      usingDefault: !rawIsSet && def.default !== undefined,
    };
  });
}

export { SCHEMA } from './schema';
export type { EnvKey } from './schema';
export { findRepoRoot } from './loader';
