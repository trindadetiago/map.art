import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects } from './projects';

/** A tile's phase. Flips `render → stylize` once, never back. */
export const TILE_PHASES = ['render', 'stylize'] as const;
/** Status within the current phase. */
export const TILE_STATUSES = ['pending', 'progress', 'done', 'error'] as const;

export type TilePhase = (typeof TILE_PHASES)[number];
export type TileStatus = (typeof TILE_STATUSES)[number];

/**
 * One row per grid cell — and the row *is* the queue entry. Workers claim rows
 * with `FOR UPDATE SKIP LOCKED`; coordination lives entirely in these columns.
 * See docs/architecture.html for the full lifecycle.
 */
export const tiles = pgTable(
  'tiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    x: integer('x').notNull(), // grid column
    y: integer('y').notNull(), // grid row
    lat: doublePrecision('lat').notNull(), // real-world center
    lng: doublePrecision('lng').notNull(),
    currentStatusType: text('current_status_type', { enum: TILE_PHASES })
      .notNull()
      .default('render'),
    status: text('status', { enum: TILE_STATUSES }).notNull().default('pending'),
    retryAttempt: integer('retry_attempt').notNull().default(0), // 0..3 per phase
    neighbors: uuid('neighbors').array().notNull().default(sql`'{}'::uuid[]`), // ≤ 8 adjacent tile ids
    renderedImgPath: text('rendered_img_path'),
    stylizedImgPath: text('stylized_img_path'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('tiles_project_xy_unique').on(t.projectId, t.x, t.y),
    // Backs the claim queries' WHERE on (phase, status). ORDER BY id rides the pk.
    index('tiles_claim_idx').on(t.currentStatusType, t.status),
  ],
);

export type Tile = typeof tiles.$inferSelect;
export type NewTile = typeof tiles.$inferInsert;
