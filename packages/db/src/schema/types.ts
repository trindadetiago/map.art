import { customType, pgEnum } from 'drizzle-orm/pg-core';

/** PostGIS polygon in WGS84. Stored as `geometry(Polygon, 4326)`. TS representation is WKT or GeoJSON text; use helpers to convert. */
export const polygon4326 = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry(Polygon, 4326)';
  },
});

export const tileSourceEnum = pgEnum('tile_source', ['rendered', 'generated', 'manual']);
export const jobKindEnum = pgEnum('job_kind', ['render', 'generate', 'regenerate']);
export const jobStatusEnum = pgEnum('job_status', [
  'pending',
  'claimed',
  'done',
  'failed',
  'cancelled',
]);
export const projectStatusEnum = pgEnum('project_status', ['setup', 'active', 'archived']);
export const modelKindEnum = pgEnum('model_kind', ['generate', 'edit']);
