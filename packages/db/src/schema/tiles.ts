import { integer, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './jobs';
import { projects } from './projects';

// Append-only. Each row is one produced artifact at grid position (x, y): a
// render job inserts a row with rendered_img_path set; a stylize job inserts a
// new row carrying the source render inline plus its stylized_img_path. There
// is no uniqueness on (project_id, x, y) — restyling appends another row, so a
// position accumulates a history and every stylized row is a self-contained
// (rendered, stylized) pair.
export const tiles = pgTable('tiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  renderedImgPath: text('rendered_img_path'),
  stylizedImgPath: text('stylized_img_path'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Tile = typeof tiles.$inferSelect;
export type NewTile = typeof tiles.$inferInsert;
