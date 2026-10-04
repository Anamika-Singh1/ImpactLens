ALTER TABLE "TestRun" ADD COLUMN "recordedAt" TIMESTAMP(3);
CREATE TABLE "TestArtifact" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "repositoryId" UUID NOT NULL,
  "format" VARCHAR(20) NOT NULL, "commitSha" VARCHAR(64) NOT NULL, "runner" VARCHAR(100) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL, "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "filename" VARCHAR(200) NOT NULL, "source" VARCHAR(1000) NOT NULL,
  "sourceRoot" VARCHAR(2000), "contentHash" CHAR(64) NOT NULL,
  "content" TEXT NOT NULL, "parsed" JSONB NOT NULL, "importedByLabel" VARCHAR(100) NOT NULL,
  CONSTRAINT "TestArtifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TestArtifact_scope_key" UNIQUE ("id", "repositoryId", "workspaceId"),
  CONSTRAINT "TestArtifact_repo_fkey" FOREIGN KEY ("repositoryId", "workspaceId") REFERENCES "Repository"("id", "workspaceId") ON DELETE CASCADE,
  CONSTRAINT "TestArtifact_format" CHECK ("format" IN ('JUNIT','ISTANBUL','LCOV','PER_TEST')),
  CONSTRAINT "TestArtifact_sha" CHECK ("commitSha" ~ '^[a-f0-9]{40}([a-f0-9]{24})?$'),
  CONSTRAINT "TestArtifact_size" CHECK (octet_length("content") <= 2097152)
);
CREATE INDEX "TestArtifact_scope_time" ON "TestArtifact"("workspaceId", "repositoryId", "recordedAt");
CREATE TABLE "FeatureTestMapping" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "repositoryId" UUID NOT NULL,
  "featureId" UUID NOT NULL, "artifactId" UUID NOT NULL,
  "testIdentity" VARCHAR(1000) NOT NULL, "runner" VARCHAR(100) NOT NULL,
  "rationale" VARCHAR(2000) NOT NULL, "actorLabel" VARCHAR(100) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureTestMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeatureTestMapping_unique" UNIQUE ("featureId", "runner", "testIdentity"),
  CONSTRAINT "FeatureTestMapping_feature_fkey" FOREIGN KEY ("featureId", "repositoryId", "workspaceId") REFERENCES "BusinessFeature"("id", "repositoryId", "workspaceId") ON DELETE CASCADE,
  CONSTRAINT "FeatureTestMapping_artifact_fkey" FOREIGN KEY ("artifactId", "repositoryId", "workspaceId") REFERENCES "TestArtifact"("id", "repositoryId", "workspaceId") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "FeatureTestMapping_scope" ON "FeatureTestMapping"("workspaceId", "repositoryId");
CREATE FUNCTION protect_test_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Imported test artifacts are immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "TestArtifact_immutable" BEFORE UPDATE ON "TestArtifact" FOR EACH ROW EXECUTE FUNCTION protect_test_artifact();
