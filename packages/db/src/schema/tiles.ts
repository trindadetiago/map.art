import { boolean, integer, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { projects } from './projects';

// Tiles are indexed by (col, row) in the project's camera-frame grid.
// col increments along camera-right direction; row along camera-forward direction.
// (col=0, row=0) is the project center tile. Signed indices are expected.
export const tiles = pgTable(
  'tiles',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    col: integer('col').notNull(),
    row: integer('row').notNull(),
    hasWater: boolean('has_water').notNull().default(false),
    currentVersionId: uuid('current_version_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.col, t.row] }),
  }),
);

export type Tile = typeof tiles.$inferSelect;
export type NewTile = typeof tiles.$inferInsert;
