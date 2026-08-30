import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { projects } from './projects';

/** Lifecycle of one export run. Terminal at `done` or `error`. */
export const EXPORT_STATUSES = ['queued', 'running', 'done', 'error'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/**
 * One row per export run, written by whoever runs the export rather than
 * inferred from logs — a log scrape can't tell "still building" from "died
 * silently", and the admin needs to show which of those happened.
 *
 * Rows are kept after they finish: the history is how you see when a project's
 * pyramid was last rebuilt, and what it contained.
 */
// Named `projectExports`, not `exports`: the bare name collides with the
// CommonJS `exports` global once drizzle-kit transpiles this module.
export const projectExports = pgTable('exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  /** Which per-tile image was stitched. */
  source: text('source').notNull(),
  status: text('status', { enum: EXPORT_STATUSES }).notNull().default('queued'),
  /** First line of the failure, when status is `error`. */
  error: text('error'),
  /** Result stats, filled in on success. */
  placed: integer('placed'),
  skipped: integer('skipped'),
  uploaded: integer('uploaded'),
  width: integer('width'),
  height: integer('height'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export type ProjectExport = typeof projectExports.$inferSelect;
export type NewProjectExport = typeof projectExports.$inferInsert;
