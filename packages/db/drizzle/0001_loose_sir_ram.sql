ALTER TABLE "jobs" ADD COLUMN "priority" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "depends_on" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "cost_cents" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "worker_version" text;--> statement-breakpoint
CREATE INDEX "jobs_poll_idx" ON "jobs" ("priority" ASC, "created_at" ASC) WHERE "status" = 'pending' AND "attempts" < "max_attempts";--> statement-breakpoint
CREATE INDEX "jobs_project_status_idx" ON "jobs" ("project_id", "status");--> statement-breakpoint
CREATE INDEX "jobs_stuck_idx" ON "jobs" ("claimed_at") WHERE "status" = 'claimed' AND "claimed_at" < now() - interval '5 minutes';
