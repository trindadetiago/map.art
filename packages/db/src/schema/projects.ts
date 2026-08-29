import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** URL key the visualizer routes on, e.g. `/joaopessoa`. Stable once public. */
  slug: text('slug').notNull().unique(),
  description: text('description'),
  /** Year the map depicts (nullable; surfaced on the visualizer placard). */
  year: integer('year'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
