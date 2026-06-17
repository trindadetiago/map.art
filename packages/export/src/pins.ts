import { getStorage } from '@mapart/storage';
import { vizPinsKey } from './keys';
import type { VizPin } from './types';

/**
 * Parse and validate a project's pin definitions from raw JSON. Throws with a
 * pointed message on the first malformed entry rather than silently dropping it
 * — a typo in a hand-written `pins.json` should fail loudly, not vanish.
 */
export function parsePins(raw: string): VizPin[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`pins must be valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error('pins must be a JSON array of { lat, lng, label }');
  }
  return data.map((entry, i) => validatePin(entry, i));
}

function validatePin(entry: unknown, i: number): VizPin {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`pin ${i}: must be an object`);
  }
  const { lat, lng, label, kind } = entry as Record<string, unknown>;
  if (typeof lat !== 'number' || lat < -90 || lat > 90) {
    throw new Error(`pin ${i}: "lat" must be a number in [-90, 90]`);
  }
  if (typeof lng !== 'number' || lng < -180 || lng > 180) {
    throw new Error(`pin ${i}: "lng" must be a number in [-180, 180]`);
  }
  if (typeof label !== 'string' || label.length === 0) {
    throw new Error(`pin ${i}: "label" must be a non-empty string`);
  }
  if (kind !== undefined && typeof kind !== 'string') {
    throw new Error(`pin ${i}: "kind" must be a string when present`);
  }
  return kind === undefined ? { lat, lng, label } : { lat, lng, label, kind };
}

/** Read a project's pins from storage. Returns `[]` if none are set. */
export async function getProjectPins(projectId: string): Promise<VizPin[]> {
  const storage = getStorage();
  const key = vizPinsKey(projectId);
  if (!(await storage.has(key))) return [];
  return parsePins((await storage.get(key)).toString('utf8'));
}

/** Validate and write a project's pins to storage, replacing any existing set. */
export async function setProjectPins(projectId: string, pins: VizPin[]): Promise<void> {
  await getStorage().put(vizPinsKey(projectId), Buffer.from(JSON.stringify(pins, null, 2)));
}
