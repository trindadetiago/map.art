/**
 * @mapart/logger — small structured logger shared by every service.
 *
 * One factory: `createLogger(name, bindings?)`. Each call returns a logger
 * scoped to a logical source (the service or component name) with optional
 * bindings — fields stamped onto every line it emits (e.g. the worker pid).
 * `log.child({...})` derives a logger with extra bindings without re-deriving
 * config.
 *
 * Output is line-per-event on two streams: debug/info on stdout, warn/error on
 * stderr. Format and threshold are resolved once from the environment:
 *   - LOG_LEVEL  debug|info|warn|error — defaults to info on Railway, else debug.
 *   - LOG_FORMAT pretty|json           — defaults to json on Railway, else pretty.
 * Pretty lines are coloured only when the target stream is a TTY, so the
 * grep-friendly `.logs/*.log` tees stay plain text.
 */
import { env } from '@mapart/env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Arbitrary structured context attached to a log line. An `Error` value is serialized specially. */
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Derive a logger that stamps `bindings` (merged over this logger's) onto every line. */
  child(bindings: LogFields): Logger;
  /** The active threshold — lines below it are dropped. */
  readonly level: LogLevel;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS: Record<LogLevel, number> = { debug: 90, info: 36, warn: 33, error: 31 };

function resolveLevel(): LogLevel {
  const raw = env.logLevel?.toLowerCase();
  if (raw && raw in LEVELS) return raw as LogLevel;
  return env.railwayEnvironmentName ? 'info' : 'debug';
}

function resolveFormat(): 'pretty' | 'json' {
  const raw = env.logFormat?.toLowerCase();
  if (raw === 'pretty' || raw === 'json') return raw;
  return env.railwayEnvironmentName ? 'json' : 'pretty';
}

const LEVEL = resolveLevel();
const THRESHOLD = LEVELS[LEVEL];
const FORMAT = resolveFormat();

function serializeError(e: Error): { name: string; message: string; stack?: string } {
  return e.stack
    ? { name: e.name, message: e.message, stack: e.stack }
    : { name: e.name, message: e.message };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const pad3 = (n: number): string => String(n).padStart(3, '0');

function paint(code: number, s: string, on: boolean): string {
  return on ? `\x1b[${code}m${s}\x1b[0m` : s;
}

/** Render a scalar/object field value compactly; quote strings only when they contain whitespace. */
function fmtValue(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === 'string') return /\s/.test(v) ? JSON.stringify(v) : v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function emit(
  level: LogLevel,
  name: string,
  bindings: LogFields,
  msg: string,
  fields?: LogFields,
): void {
  if (LEVELS[level] < THRESHOLD) return;

  const merged: LogFields = { ...bindings, ...fields };
  const stream = LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout;

  if (FORMAT === 'json') {
    const rec: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      name,
      msg,
    };
    for (const [k, v] of Object.entries(merged)) {
      rec[k] = v instanceof Error ? serializeError(v) : v;
    }
    stream.write(`${JSON.stringify(rec)}\n`);
    return;
  }

  const useColor = stream.isTTY === true;
  const t = new Date();
  const ts = `${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}.${pad3(t.getMilliseconds())}`;

  const parts: string[] = [];
  let errTail = '';
  for (const [k, v] of Object.entries(merged)) {
    if (v instanceof Error) {
      parts.push(`${k}=${fmtValue(v.message)}`);
      if (v.stack) errTail += `\n${v.stack}`;
      continue;
    }
    parts.push(`${k}=${fmtValue(v)}`);
  }

  const head = `${paint(90, ts, useColor)} ${paint(COLORS[level], level.toUpperCase().padEnd(5), useColor)} ${paint(1, name, useColor)}`;
  const tail = parts.length > 0 ? `  ${parts.join(' ')}` : '';
  stream.write(`${head} ${msg}${tail}${errTail}\n`);
}

/**
 * Create a logger scoped to `name` (the logical source — a service or
 * component). `bindings` are stamped onto every line it emits.
 */
export function createLogger(name: string, bindings: LogFields = {}): Logger {
  const make = (b: LogFields): Logger => ({
    debug: (msg, fields) => emit('debug', name, b, msg, fields),
    info: (msg, fields) => emit('info', name, b, msg, fields),
    warn: (msg, fields) => emit('warn', name, b, msg, fields),
    error: (msg, fields) => emit('error', name, b, msg, fields),
    child: (extra) => make({ ...b, ...extra }),
    level: LEVEL,
  });
  return make(bindings);
}

/** A logger that discards everything — for tests and call-sites that want no output. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
  level: 'error',
};
