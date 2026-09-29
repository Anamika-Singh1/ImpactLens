-- Check restrictive references at commit, allowing whole-workspace cascades
-- while still rejecting orphaned or cross-tenant links atomically.
BEGIN;
ALTER TABLE "DependencyEdge" ALTER CONSTRAINT "DependencyEdge_toFileId_snapshotId_repositoryId_workspaceI_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Analysis" ALTER CONSTRAINT "Analysis_baseSnapshotId_repositoryId_workspaceId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Analysis" ALTER CONSTRAINT "Analysis_headSnapshotId_repositoryId_workspaceId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Finding" ALTER CONSTRAINT "Finding_featureId_repositoryId_workspaceId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "FindingEvidence" ALTER CONSTRAINT "FindingEvidence_evidenceId_repositoryId_workspaceId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "TestRecommendation" ALTER CONSTRAINT "TestRecommendation_testCaseId_repositoryId_workspaceId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "RecommendationEvidence" ALTER CONSTRAINT "RecommendationEvidence_evidenceId_repositoryId_workspaceId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AuditEvent" ALTER CONSTRAINT "AuditEvent_repositoryId_workspaceId_fkey" DEFERRABLE INITIALLY DEFERRED;
COMMIT;
