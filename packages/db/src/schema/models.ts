import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { modelKindEnum } from './types';

export const models = pgTable('models', {
  id: text('id').primaryKey(),
  kind: modelKindEnum('kind').notNull(),
  endpoint: text('endpoint').notNull(),
  config: jsonb('config').notNull().default({}),
  notes: text('notes'),
  active: boolean('active').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Model = typeof models.$inferSelect;
export type NewModel = typeof models.$inferInsert;
