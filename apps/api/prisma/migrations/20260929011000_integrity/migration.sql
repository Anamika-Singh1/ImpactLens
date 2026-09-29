BEGIN;

ALTER TABLE "User" ADD CONSTRAINT "User_normalized_email" CHECK ("email" = lower(btrim("email")));
CREATE UNIQUE INDEX "Membership_single_owner" ON "Membership" ("workspaceId") WHERE "role" = 'OWNER';
ALTER TABLE "RepositorySnapshot" ADD CONSTRAINT "Snapshot_full_sha" CHECK ("commitSha" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$');
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_full_sha" CHECK ("commitSha" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$');
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_content_hash" CHECK ("contentHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "SourceFile" ADD CONSTRAINT "SourceFile_content_hash" CHECK ("contentHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "CoverageArtifact" ADD CONSTRAINT "Coverage_content_hash" CHECK ("contentHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "SourceSymbol" ADD CONSTRAINT "Symbol_line_range" CHECK ("startLine" > 0 AND "endLine" >= "startLine");
ALTER TABLE "DependencyEdge" ADD CONSTRAINT "Edge_line" CHECK ("line" > 0);
ALTER TABLE "TestRecommendation" ADD CONSTRAINT "Recommendation_existing_or_suggestion" CHECK ("isSuggestion" OR "testCaseId" IS NOT NULL);

CREATE FUNCTION reject_immutable_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable; insert a new record instead', TG_TABLE_NAME;
END $$;
CREATE TRIGGER snapshot_immutable BEFORE UPDATE ON "RepositorySnapshot" FOR EACH ROW EXECUTE FUNCTION reject_immutable_update();
CREATE TRIGGER evidence_immutable BEFORE UPDATE ON "Evidence" FOR EACH ROW EXECUTE FUNCTION reject_immutable_update();
CREATE TRIGGER audit_immutable BEFORE UPDATE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_immutable_update();

-- Deferred constraints allow a finding and its evidence links to be written
-- atomically in either order, but never committed without evidence.
CREATE FUNCTION require_finding_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  FOR target IN
    SELECT DISTINCT value::uuid FROM unnest(ARRAY[
      CASE WHEN TG_TABLE_NAME = 'Finding' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'findingId' END,
      CASE WHEN TG_TABLE_NAME = 'Finding' THEN to_jsonb(OLD)->>'id' ELSE to_jsonb(OLD)->>'findingId' END
    ]) AS value WHERE value IS NOT NULL
  LOOP
    IF EXISTS (SELECT 1 FROM "Finding" WHERE id = target AND kind <> 'SUGGESTION')
       AND NOT EXISTS (SELECT 1 FROM "FindingEvidence" WHERE "findingId" = target) THEN
      RAISE EXCEPTION 'A non-suggestion finding requires evidence';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER finding_requires_evidence AFTER INSERT OR UPDATE ON "Finding" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_finding_evidence();
CREATE CONSTRAINT TRIGGER finding_link_required AFTER INSERT OR UPDATE OR DELETE ON "FindingEvidence" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_finding_evidence();

CREATE FUNCTION require_recommendation_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  FOR target IN
    SELECT DISTINCT value::uuid FROM unnest(ARRAY[
      CASE WHEN TG_TABLE_NAME = 'TestRecommendation' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'recommendationId' END,
      CASE WHEN TG_TABLE_NAME = 'TestRecommendation' THEN to_jsonb(OLD)->>'id' ELSE to_jsonb(OLD)->>'recommendationId' END
    ]) AS value WHERE value IS NOT NULL
  LOOP
    IF EXISTS (SELECT 1 FROM "TestRecommendation" WHERE id = target AND NOT "isSuggestion")
       AND NOT EXISTS (SELECT 1 FROM "RecommendationEvidence" WHERE "recommendationId" = target) THEN
      RAISE EXCEPTION 'A non-suggestion recommendation requires evidence';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER recommendation_requires_evidence AFTER INSERT OR UPDATE ON "TestRecommendation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_recommendation_evidence();
CREATE CONSTRAINT TRIGGER recommendation_link_required AFTER INSERT OR UPDATE OR DELETE ON "RecommendationEvidence" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_recommendation_evidence();
COMMIT;
