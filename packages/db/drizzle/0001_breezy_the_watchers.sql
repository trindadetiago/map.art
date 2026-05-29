CREATE TABLE IF NOT EXISTS "tiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"current_status_type" text DEFAULT 'render' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retry_attempt" integer DEFAULT 0 NOT NULL,
	"neighbors" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"rendered_img_path" text,
	"stylized_img_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tiles_project_xy_unique" UNIQUE("project_id","x","y")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tiles" ADD CONSTRAINT "tiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tiles_claim_idx" ON "tiles" USING btree ("current_status_type","status");