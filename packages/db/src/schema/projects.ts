import { integer, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { models } from './models';
import { projectStatusEnum } from './types';

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  // Project center — the (col=0, row=0) tile sits here.
  centerLat: real('center_lat').notNull(),
  centerLng: real('center_lng').notNull(),
  // Camera pose applied to every tile during render.
  cameraPitch: real('camera_pitch').notNull().default(30),
  cameraYaw: real('camera_yaw').notNull().default(45),
  // One tile's width on the image plane, expressed in ground meters. Combined
  // with pitch this determines the ground footprint of every tile capture.
  tileWorldMeters: real('tile_world_meters').notNull().default(150),
  // Output PNG dimensions per tile (pixels, square).
  tilePixelSize: integer('tile_pixel_size').notNull().default(512),
  defaultModelId: text('default_model_id').references(() => models.id, { onDelete: 'set null' }),
  status: projectStatusEnum('status').notNull().default('setup'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
