import { foreignKey, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { models } from './models';
import { projects } from './projects';
import { tiles } from './tiles';
import { tileSourceEnum } from './types';

export const tileVersions = pgTable(
  'tile_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    col: integer('col').notNull(),
    row: integer('row').notNull(),
    source: tileSourceEnum('source').notNull(),
    storageKey: text('storage_key').notNull(),
    modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
    prompt: text('prompt'),
    referenceStorageKey: text('reference_storage_key'),
    inputHash: text('input_hash'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by').notNull().default('system'),
  },
  (t) => ({
    tileFk: foreignKey({
      columns: [t.projectId, t.col, t.row],
      foreignColumns: [tiles.projectId, tiles.col, tiles.row],
    }).onDelete('cascade'),
  }),
);

export type TileVersion = typeof tileVersions.$inferSelect;
export type NewTileVersion = typeof tileVersions.$inferInsert;
