import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { models } from './models';
import { projects } from './projects';
import { tileVersions } from './tile-versions';
import { jobKindEnum, jobStatusEnum } from './types';

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  kind: jobKindEnum('kind').notNull(),
  col: integer('col').notNull(),
  row: integer('row').notNull(),
  modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
  payload: jsonb('payload').notNull().default({}),
  status: jobStatusEnum('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  claimedBy: text('claimed_by'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  idempotencyKey: text('idempotency_key').unique(),
  resultVersionId: uuid('result_version_id').references(() => tileVersions.id, {
    onDelete: 'set null',
  }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
