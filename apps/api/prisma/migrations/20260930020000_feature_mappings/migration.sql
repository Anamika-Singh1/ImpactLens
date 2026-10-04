ALTER TABLE "BusinessFeature"
  ADD COLUMN "criticality" VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "responsibleTeam" VARCHAR(150),
  ADD COLUMN "customerWorkflow" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "BusinessFeature_criticality_check" CHECK ("criticality" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  ADD CONSTRAINT "BusinessFeature_version_check" CHECK ("version" > 0);

ALTER TABLE "FeatureMapping"
  ADD COLUMN "nodeId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "target" JSONB,
  ADD COLUMN "anchorHash" CHAR(64),
  ADD COLUMN "status" VARCHAR(30) NOT NULL DEFAULT 'NEEDS_REVIEW',
  ADD COLUMN "origin" VARCHAR(20) NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "heuristic" JSONB,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "confirmedById" UUID,
  ADD COLUMN "confirmedByLabel" TEXT,
  ADD CONSTRAINT "FeatureMapping_status_check" CHECK ("status" IN ('SUGGESTED', 'CONFIRMED', 'REJECTED', 'NEEDS_REVIEW')),
  ADD CONSTRAINT "FeatureMapping_origin_check" CHECK ("origin" IN ('MANUAL', 'HEURISTIC', 'LEGACY')),
  ADD CONSTRAINT "FeatureMapping_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "FeatureMapping_confirmation_check" CHECK ("status" <> 'CONFIRMED' OR ("confirmedAt" IS NOT NULL AND "confirmedByLabel" IS NOT NULL AND "target" IS NOT NULL AND "anchorHash" IS NOT NULL)),
  ADD CONSTRAINT "FeatureMapping_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing mappings have no reliable confirmer. Preserve them as requiring review.
UPDATE "FeatureMapping" m SET "nodeId" = 'file:' || f."path" FROM "SourceFile" f WHERE f."id" = m."fileId";
DROP INDEX "FeatureMapping_workspaceId_repositoryId_featureId_snapshotI_key";
CREATE UNIQUE INDEX "FeatureMapping_target_key" ON "FeatureMapping" ("workspaceId", "repositoryId", "featureId", "snapshotId", "fileId", "nodeId");
CREATE UNIQUE INDEX "FeatureMapping_id_repositoryId_workspaceId_key" ON "FeatureMapping" ("id", "repositoryId", "workspaceId");

CREATE TABLE "MappingRevision" (
  "id" UUID NOT NULL,
  "mappingId" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "repositoryId" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "action" VARCHAR(30) NOT NULL,
  "actorId" UUID,
  "actorLabel" TEXT NOT NULL,
  "snapshotId" UUID NOT NULL,
  "state" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MappingRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MappingRevision_mapping_fkey" FOREIGN KEY ("mappingId", "repositoryId", "workspaceId") REFERENCES "FeatureMapping"("id", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MappingRevision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MappingRevision_snapshot_fkey" FOREIGN KEY ("snapshotId", "repositoryId", "workspaceId") REFERENCES "RepositorySnapshot"("id", "repositoryId", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX "MappingRevision_mappingId_revision_key" ON "MappingRevision" ("mappingId", "revision");
CREATE INDEX "MappingRevision_workspaceId_repositoryId_idx" ON "MappingRevision" ("workspaceId", "repositoryId");
INSERT INTO "MappingRevision" ("id", "mappingId", "workspaceId", "repositoryId", "revision", "action", "actorLabel", "snapshotId", "state")
  SELECT gen_random_uuid(), m."id", m."workspaceId", m."repositoryId", 1, 'LEGACY_IMPORTED', 'Unknown (legacy record)', m."snapshotId", to_jsonb(m)
  FROM "FeatureMapping" m;

CREATE FUNCTION protect_mapping_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Permit actor anonymization on account deletion, without changing recorded attribution.
  IF TG_OP = 'UPDATE' AND NEW."actorId" IS NULL AND OLD."actorId" IS NOT NULL
     AND (to_jsonb(NEW) - 'actorId') = (to_jsonb(OLD) - 'actorId') THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "FeatureMapping" WHERE "id" = OLD."mappingId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Mapping history is immutable';
END;
$$;
CREATE TRIGGER "MappingRevision_immutable" BEFORE UPDATE OR DELETE ON "MappingRevision" FOR EACH ROW EXECUTE FUNCTION protect_mapping_revision();
