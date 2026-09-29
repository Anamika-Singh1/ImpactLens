BEGIN;
-- Phase 1 exposed no repository writes. Do not silently assign any manually
-- inserted legacy records to an arbitrary tenant.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Repository") THEN
    RAISE EXCEPTION 'Unscoped Phase 1 repositories exist. Back up and explicitly assign ownership before migrating.';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ENGINEER', 'VIEWER');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('DRAFT', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FindingKind" AS ENUM ('POTENTIAL_IMPACT', 'COVERAGE_LIMITATION', 'ANALYSIS_LIMITATION', 'SUGGESTION');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('SOURCE', 'DEPENDENCY', 'FEATURE_MAPPING', 'TEST_RESULT', 'COVERAGE');

-- CreateEnum
CREATE TYPE "TestOutcome" AS ENUM ('PASSED', 'FAILED', 'SKIPPED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ReviewOutcome" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'ACKNOWLEDGED');

-- DropIndex
DROP INDEX "Repository_owner_name_key";

-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "workspaceId" UUID NOT NULL,
ALTER COLUMN "owner" SET DATA TYPE VARCHAR(100),
ALTER COLUMN "name" SET DATA TYPE VARCHAR(100);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "csrfToken" VARCHAR(64) NOT NULL,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("workspaceId","userId")
);

-- CreateTable
CREATE TABLE "RepositorySnapshot" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "commitSha" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepositorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceFile" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "language" VARCHAR(30) NOT NULL,

    CONSTRAINT "SourceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSymbol" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" VARCHAR(50) NOT NULL,
    "startLine" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,

    CONSTRAINT "SourceSymbol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DependencyEdge" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "fromFileId" UUID NOT NULL,
    "toFileId" UUID,
    "specifier" TEXT NOT NULL,
    "kind" VARCHAR(50) NOT NULL,
    "line" INTEGER NOT NULL,
    "limitation" TEXT,

    CONSTRAINT "DependencyEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessFeature" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureMapping" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "featureId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "rationale" TEXT NOT NULL,

    CONSTRAINT "FeatureMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "baseSnapshotId" UUID NOT NULL,
    "headSnapshotId" UUID NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisJob" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "analysisId" UUID NOT NULL,
    "queueJobId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "analysisId" UUID NOT NULL,
    "featureId" UUID,
    "kind" "FindingKind" NOT NULL,
    "summary" TEXT NOT NULL,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "commitSha" VARCHAR(64) NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "locator" TEXT NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingEvidence" (
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "findingId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,

    CONSTRAINT "FindingEvidence_pkey" PRIMARY KEY ("findingId","evidenceId")
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "provider" VARCHAR(100) NOT NULL,
    "externalRunId" TEXT NOT NULL,
    "outcome" "TestOutcome" NOT NULL DEFAULT 'UNKNOWN',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCase" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "testRunId" UUID NOT NULL,
    "identity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT,
    "outcome" "TestOutcome" NOT NULL DEFAULT 'UNKNOWN',

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageArtifact" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "testRunId" UUID NOT NULL,
    "format" VARCHAR(50) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRecommendation" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "analysisId" UUID NOT NULL,
    "testCaseId" UUID,
    "isSuggestion" BOOLEAN NOT NULL DEFAULT false,
    "rationale" TEXT NOT NULL,

    CONSTRAINT "TestRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationEvidence" (
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "recommendationId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,

    CONSTRAINT "RecommendationEvidence_pkey" PRIMARY KEY ("recommendationId","evidenceId")
);

-- CreateTable
CREATE TABLE "ReviewDecision" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "analysisId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "outcome" "ReviewOutcome" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID,
    "actorId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "targetId" TEXT,
    "requestId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Membership_userId_workspaceId_idx" ON "Membership"("userId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "RepositorySnapshot_id_repositoryId_workspaceId_key" ON "RepositorySnapshot"("id", "repositoryId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "RepositorySnapshot_id_repositoryId_workspaceId_commitSha_key" ON "RepositorySnapshot"("id", "repositoryId", "workspaceId", "commitSha");

-- CreateIndex
CREATE UNIQUE INDEX "RepositorySnapshot_workspaceId_repositoryId_commitSha_key" ON "RepositorySnapshot"("workspaceId", "repositoryId", "commitSha");

-- CreateIndex
CREATE UNIQUE INDEX "SourceFile_id_snapshotId_repositoryId_workspaceId_key" ON "SourceFile"("id", "snapshotId", "repositoryId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceFile_workspaceId_repositoryId_snapshotId_path_key" ON "SourceFile"("workspaceId", "repositoryId", "snapshotId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "SourceSymbol_workspaceId_repositoryId_snapshotId_fileId_nam_key" ON "SourceSymbol"("workspaceId", "repositoryId", "snapshotId", "fileId", "name", "startLine", "kind");

-- CreateIndex
CREATE INDEX "DependencyEdge_workspaceId_repositoryId_snapshotId_toFileId_idx" ON "DependencyEdge"("workspaceId", "repositoryId", "snapshotId", "toFileId");

-- CreateIndex
CREATE UNIQUE INDEX "DependencyEdge_workspaceId_repositoryId_snapshotId_fromFile_key" ON "DependencyEdge"("workspaceId", "repositoryId", "snapshotId", "fromFileId", "specifier", "line", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessFeature_id_repositoryId_workspaceId_key" ON "BusinessFeature"("id", "repositoryId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessFeature_workspaceId_repositoryId_key_key" ON "BusinessFeature"("workspaceId", "repositoryId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureMapping_workspaceId_repositoryId_featureId_snapshotI_key" ON "FeatureMapping"("workspaceId", "repositoryId", "featureId", "snapshotId", "fileId");

-- CreateIndex
CREATE INDEX "Analysis_workspaceId_repositoryId_createdAt_idx" ON "Analysis"("workspaceId", "repositoryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Analysis_id_repositoryId_workspaceId_key" ON "Analysis"("id", "repositoryId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisJob_queueJobId_key" ON "AnalysisJob"("queueJobId");

-- CreateIndex
CREATE INDEX "AnalysisJob_workspaceId_repositoryId_analysisId_status_idx" ON "AnalysisJob"("workspaceId", "repositoryId", "analysisId", "status");

-- CreateIndex
CREATE INDEX "Finding_workspaceId_repositoryId_analysisId_idx" ON "Finding"("workspaceId", "repositoryId", "analysisId");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_id_repositoryId_workspaceId_key" ON "Finding"("id", "repositoryId", "workspaceId");

-- CreateIndex
CREATE INDEX "Evidence_workspaceId_repositoryId_snapshotId_kind_idx" ON "Evidence"("workspaceId", "repositoryId", "snapshotId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_id_repositoryId_workspaceId_key" ON "Evidence"("id", "repositoryId", "workspaceId");

-- CreateIndex
CREATE INDEX "FindingEvidence_workspaceId_repositoryId_evidenceId_idx" ON "FindingEvidence"("workspaceId", "repositoryId", "evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "TestRun_id_repositoryId_workspaceId_key" ON "TestRun"("id", "repositoryId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "TestRun_workspaceId_repositoryId_snapshotId_provider_extern_key" ON "TestRun"("workspaceId", "repositoryId", "snapshotId", "provider", "externalRunId");

-- CreateIndex
CREATE UNIQUE INDEX "TestCase_id_repositoryId_workspaceId_key" ON "TestCase"("id", "repositoryId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "TestCase_workspaceId_repositoryId_testRunId_identity_key" ON "TestCase"("workspaceId", "repositoryId", "testRunId", "identity");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageArtifact_workspaceId_repositoryId_testRunId_content_key" ON "CoverageArtifact"("workspaceId", "repositoryId", "testRunId", "contentHash");

-- CreateIndex
CREATE INDEX "TestRecommendation_workspaceId_repositoryId_analysisId_idx" ON "TestRecommendation"("workspaceId", "repositoryId", "analysisId");

-- CreateIndex
CREATE UNIQUE INDEX "TestRecommendation_id_repositoryId_workspaceId_key" ON "TestRecommendation"("id", "repositoryId", "workspaceId");

-- CreateIndex
CREATE INDEX "RecommendationEvidence_workspaceId_repositoryId_evidenceId_idx" ON "RecommendationEvidence"("workspaceId", "repositoryId", "evidenceId");

-- CreateIndex
CREATE INDEX "ReviewDecision_workspaceId_repositoryId_analysisId_createdA_idx" ON "ReviewDecision"("workspaceId", "repositoryId", "analysisId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_createdAt_idx" ON "AuditEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_repositoryId_createdAt_idx" ON "AuditEvent"("workspaceId", "repositoryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_id_workspaceId_key" ON "Repository"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_workspaceId_owner_name_key" ON "Repository"("workspaceId", "owner", "name");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositorySnapshot" ADD CONSTRAINT "RepositorySnapshot_repositoryId_workspaceId_fkey" FOREIGN KEY ("repositoryId", "workspaceId") REFERENCES "Repository"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceFile" ADD CONSTRAINT "SourceFile_snapshotId_repositoryId_workspaceId_fkey" FOREIGN KEY ("snapshotId", "repositoryId", "workspaceId") REFERENCES "RepositorySnapshot"("id", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSymbol" ADD CONSTRAINT "SourceSymbol_fileId_snapshotId_repositoryId_workspaceId_fkey" FOREIGN KEY ("fileId", "snapshotId", "repositoryId", "workspaceId") REFERENCES "SourceFile"("id", "snapshotId", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DependencyEdge" ADD CONSTRAINT "DependencyEdge_fromFileId_snapshotId_repositoryId_workspac_fkey" FOREIGN KEY ("fromFileId", "snapshotId", "repositoryId", "workspaceId") REFERENCES "SourceFile"("id", "snapshotId", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DependencyEdge" ADD CONSTRAINT "DependencyEdge_toFileId_snapshotId_repositoryId_workspaceI_fkey" FOREIGN KEY ("toFileId", "snapshotId", "repositoryId", "workspaceId") REFERENCES "SourceFile"("id", "snapshotId", "repositoryId", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessFeature" ADD CONSTRAINT "BusinessFeature_repositoryId_workspaceId_fkey" FOREIGN KEY ("repositoryId", "workspaceId") REFERENCES "Repository"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureMapping" ADD CONSTRAINT "FeatureMapping_featureId_repositoryId_workspaceId_fkey" FOREIGN KEY ("featureId", "repositoryId", "workspaceId") REFERENCES "BusinessFeature"("id", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureMapping" ADD CONSTRAINT "FeatureMapping_fileId_snapshotId_repositoryId_workspaceId_fkey" FOREIGN KEY ("fileId", "snapshotId", "repositoryId", "workspaceId") REFERENCES "SourceFile"("id", "snapshotId", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_repositoryId_workspaceId_fkey" FOREIGN KEY ("repositoryId", "workspaceId") REFERENCES "Repository"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_baseSnapshotId_repositoryId_workspaceId_fkey" FOREIGN KEY ("baseSnapshotId", "repositoryId", "workspaceId") REFERENCES "RepositorySnapshot"("id", "repositoryId", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_headSnapshotId_repositoryId_workspaceId_fkey" FOREIGN KEY ("headSnapshotId", "repositoryId", "workspaceId") REFERENCES "RepositorySnapshot"("id", "repositoryId", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_analysisId_repositoryId_workspaceId_fkey" FOREIGN KEY ("analysisId", "repositoryId", "workspaceId") REFERENCES "Analysis"("id", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_analysisId_repositoryId_workspaceId_fkey" FOREIGN KEY ("analysisId", "repositoryId", "workspaceId") REFERENCES "Analysis"("id", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_featureId_repositoryId_workspaceId_fkey" FOREIGN KEY ("featureId", "repositoryId", "workspaceId") REFERENCES "BusinessFeature"("id", "repositoryId", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_snapshotId_repositoryId_workspaceId_commitSha_fkey" FOREIGN KEY ("snapshotId", "repositoryId", "workspaceId", "commitSha") REFERENCES "RepositorySnapshot"("id", "repositoryId", "workspaceId", "commitSha") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingEvidence" ADD CONSTRAINT "FindingEvidence_findingId_repositoryId_workspaceId_fkey" FOREIGN KEY ("findingId", "repositoryId", "workspaceId") REFERENCES "Finding"("id", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingEvidence" ADD CONSTRAINT "FindingEvidence_evidenceId_repositoryId_workspaceId_fkey" FOREIGN KEY ("evidenceId", "repositoryId", "workspaceId") REFERENCES "Evidence"("id", "repositoryId", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_snapshotId_repositoryId_workspaceId_fkey" FOREIGN KEY ("snapshotId", "repositoryId", "workspaceId") REFERENCES "RepositorySnapshot"("id", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_testRunId_repositoryId_workspaceId_fkey" FOREIGN KEY ("testRunId", "repositoryId", "workspaceId") REFERENCES "TestRun"("id", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageArtifact" ADD CONSTRAINT "CoverageArtifact_testRunId_repositoryId_workspaceId_fkey" FOREIGN KEY ("testRunId", "repositoryId", "workspaceId") REFERENCES "TestRun"("id", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRecommendation" ADD CONSTRAINT "TestRecommendation_analysisId_repositoryId_workspaceId_fkey" FOREIGN KEY ("analysisId", "repositoryId", "workspaceId") REFERENCES "Analysis"("id", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRecommendation" ADD CONSTRAINT "TestRecommendation_testCaseId_repositoryId_workspaceId_fkey" FOREIGN KEY ("testCaseId", "repositoryId", "workspaceId") REFERENCES "TestCase"("id", "repositoryId", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationEvidence" ADD CONSTRAINT "RecommendationEvidence_recommendationId_repositoryId_works_fkey" FOREIGN KEY ("recommendationId", "repositoryId", "workspaceId") REFERENCES "TestRecommendation"("id", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationEvidence" ADD CONSTRAINT "RecommendationEvidence_evidenceId_repositoryId_workspaceId_fkey" FOREIGN KEY ("evidenceId", "repositoryId", "workspaceId") REFERENCES "Evidence"("id", "repositoryId", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_analysisId_repositoryId_workspaceId_fkey" FOREIGN KEY ("analysisId", "repositoryId", "workspaceId") REFERENCES "Analysis"("id", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_repositoryId_workspaceId_fkey" FOREIGN KEY ("repositoryId", "workspaceId") REFERENCES "Repository"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
COMMIT;
