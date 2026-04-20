CREATE TYPE "public"."job_kind" AS ENUM('render', 'generate', 'regenerate');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'claimed', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."model_kind" AS ENUM('generate', 'edit');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('setup', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."tile_source" AS ENUM('rendered', 'generated', 'manual');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "models" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "model_kind" NOT NULL,
	"endpoint" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"center_lat" real NOT NULL,
	"center_lng" real NOT NULL,
	"camera_pitch" real DEFAULT 30 NOT NULL,
	"camera_yaw" real DEFAULT 45 NOT NULL,
	"tile_world_meters" real DEFAULT 150 NOT NULL,
	"tile_pixel_size" integer DEFAULT 512 NOT NULL,
	"default_model_id" text,
	"status" "project_status" DEFAULT 'setup' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tiles" (
	"project_id" uuid NOT NULL,
	"col" integer NOT NULL,
	"row" integer NOT NULL,
	"has_water" boolean DEFAULT false NOT NULL,
	"current_version_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tiles_project_id_col_row_pk" PRIMARY KEY("project_id","col","row")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"col" integer NOT NULL,
	"row" integer NOT NULL,
	"source" "tile_source" NOT NULL,
	"storage_key" text NOT NULL,
	"model_id" text,
	"prompt" text,
	"reference_storage_key" text,
	"input_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "job_kind" NOT NULL,
	"col" integer NOT NULL,
	"row" integer NOT NULL,
	"model_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"idempotency_key" text,
	"result_version_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_default_model_id_models_id_fk" FOREIGN KEY ("default_model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tiles" ADD CONSTRAINT "tiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tile_versions" ADD CONSTRAINT "tile_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tile_versions" ADD CONSTRAINT "tile_versions_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tile_versions" ADD CONSTRAINT "tile_versions_project_id_col_row_tiles_project_id_col_row_fk" FOREIGN KEY ("project_id","col","row") REFERENCES "public"."tiles"("project_id","col","row") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_result_version_id_tile_versions_id_fk" FOREIGN KEY ("result_version_id") REFERENCES "public"."tile_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
