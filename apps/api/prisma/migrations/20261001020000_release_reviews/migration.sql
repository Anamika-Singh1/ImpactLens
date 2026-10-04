ALTER TYPE "ReviewOutcome" ADD VALUE 'NEEDS_MORE_EVIDENCE';
ALTER TABLE "ReviewDecision"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "recordVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "baseSha" VARCHAR(64), ADD COLUMN "headSha" VARCHAR(64),
  ADD COLUMN "analysisResultHash" CHAR(64), ADD COLUMN "reviewerLabel" VARCHAR(100),
  ADD COLUMN "isOverride" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "concerns" JSONB;
WITH numbered AS (
  SELECT "id", row_number() OVER (PARTITION BY "analysisId" ORDER BY "createdAt", "id") AS n FROM "ReviewDecision"
) UPDATE "ReviewDecision" r SET "revision" = numbered.n FROM numbered WHERE r."id" = numbered."id";
UPDATE "ReviewDecision" r SET "baseSha" = b."commitSha", "headSha" = h."commitSha", "analysisResultHash" = a."resultHash", "reviewerLabel" = u."name"
FROM "Analysis" a, "RepositorySnapshot" b, "RepositorySnapshot" h, "User" u
WHERE r."analysisId"=a."id" AND a."baseSnapshotId"=b."id" AND a."headSnapshotId"=h."id" AND r."reviewerId"=u."id";
ALTER TABLE "ReviewDecision" ALTER COLUMN "recordVersion" SET DEFAULT 1;
CREATE UNIQUE INDEX "ReviewDecision_analysisId_revision_key" ON "ReviewDecision"("analysisId", "revision");
CREATE FUNCTION enforce_release_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a RECORD;
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM "Analysis" WHERE "id"=OLD."analysisId") THEN RAISE EXCEPTION 'Review history is append-only'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Review history is append-only'; END IF;
  SELECT x."status", x."resultHash", x."engineVersion", b."commitSha" AS base, h."commitSha" AS head INTO a
    FROM "Analysis" x JOIN "RepositorySnapshot" b ON b."id"=x."baseSnapshotId" JOIN "RepositorySnapshot" h ON h."id"=x."headSnapshotId"
    WHERE x."id"=NEW."analysisId" AND x."workspaceId"=NEW."workspaceId" AND x."repositoryId"=NEW."repositoryId";
  IF NOT FOUND OR a."status" <> 'COMPLETED' OR a."engineVersion" IS NULL OR a."resultHash" IS NULL
    OR NEW."baseSha" IS DISTINCT FROM a.base OR NEW."headSha" IS DISTINCT FROM a.head OR NEW."analysisResultHash" IS DISTINCT FROM a."resultHash"
    OR NEW."recordVersion" <> 1 OR NEW."outcome"::text NOT IN ('APPROVED','CHANGES_REQUESTED','NEEDS_MORE_EVIDENCE')
    OR NEW."reviewerLabel" IS NULL OR NEW."revision" < 1 THEN RAISE EXCEPTION 'Review must bind to a completed analysis and exact commit pair'; END IF;
  IF NEW."isOverride" AND (NEW."comment" IS NULL OR length(btrim(NEW."comment"))=0) THEN RAISE EXCEPTION 'An override requires rationale'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "ReviewDecision_protected" BEFORE INSERT OR UPDATE OR DELETE ON "ReviewDecision" FOR EACH ROW EXECUTE FUNCTION enforce_release_review();
