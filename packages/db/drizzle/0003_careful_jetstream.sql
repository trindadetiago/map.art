ALTER TABLE "projects" ADD COLUMN "slug" text;--> statement-breakpoint
-- Backfill from `name`: fold accents, collapse every non-alphanumeric run to a
-- single dash, fall back to 'project' when nothing survives, and break ties on
-- the resulting base with a numeric suffix so the unique constraint holds.
UPDATE "projects" AS p
SET "slug" = c.slug
FROM (
  SELECT id, CASE WHEN rn = 1 THEN base ELSE base || '-' || rn END AS slug
  FROM (
    SELECT id, base, row_number() OVER (PARTITION BY base ORDER BY created_at, id) AS rn
    FROM (
      SELECT
        id,
        created_at,
        COALESCE(
          NULLIF(
            trim(BOTH '-' FROM regexp_replace(
              lower(translate(
                "name",
                'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
              )),
              '[^a-z0-9]+', '-', 'g'
            )),
            ''
          ),
          'project'
        ) AS base
      FROM "projects"
    ) AS slugged
  ) AS ranked
) AS c
WHERE p.id = c.id;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_slug_unique" UNIQUE("slug");
