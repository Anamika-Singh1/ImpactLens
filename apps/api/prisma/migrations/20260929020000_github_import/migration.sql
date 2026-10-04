-- CreateEnum
CREATE TYPE "RepositorySource" AS ENUM ('METADATA', 'GITHUB', 'FIXTURE');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED');

-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "githubRepositoryId" TEXT,
ADD COLUMN     "installationId" UUID,
ADD COLUMN     "source" "RepositorySource" NOT NULL DEFAULT 'METADATA';

-- AlterTable
ALTER TABLE "RepositorySnapshot" ADD COLUMN     "importSummary" JSONB,
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SourceFile" ADD COLUMN     "contentText" TEXT;

-- CreateTable
CREATE TABLE "GitHubAuthorization" (
    "userId" UUID NOT NULL,
    "githubUserId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubAuthorization_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "GitHubFlow" (
    "stateHash" CHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "verifier" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubFlow_pkey" PRIMARY KEY ("stateHash")
);

-- CreateTable
CREATE TABLE "GitHubInstallation" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "githubInstallationId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitHubInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "commitSha" VARCHAR(64) NOT NULL,
    "branch" VARCHAR(255) NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT NOT NULL DEFAULT 'Waiting for worker',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "snapshotId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GitHubFlow_expiresAt_idx" ON "GitHubFlow"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubInstallation_id_workspaceId_key" ON "GitHubInstallation"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubInstallation_workspaceId_githubInstallationId_key" ON "GitHubInstallation"("workspaceId", "githubInstallationId");

-- CreateIndex
CREATE INDEX "ImportJob_workspaceId_createdAt_idx" ON "ImportJob"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_status_updatedAt_idx" ON "ImportJob"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportJob_workspaceId_repositoryId_commitSha_key" ON "ImportJob"("workspaceId", "repositoryId", "commitSha");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_workspaceId_githubRepositoryId_key" ON "Repository"("workspaceId", "githubRepositoryId");

-- AddForeignKey
ALTER TABLE "GitHubAuthorization" ADD CONSTRAINT "GitHubAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubFlow" ADD CONSTRAINT "GitHubFlow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubFlow" ADD CONSTRAINT "GitHubFlow_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubFlow" ADD CONSTRAINT "GitHubFlow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubInstallation" ADD CONSTRAINT "GitHubInstallation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_repositoryId_workspaceId_fkey" FOREIGN KEY ("repositoryId", "workspaceId") REFERENCES "Repository"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_snapshotId_repositoryId_workspaceId_fkey" FOREIGN KEY ("snapshotId", "repositoryId", "workspaceId") REFERENCES "RepositorySnapshot"("id", "repositoryId", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_installationId_workspaceId_fkey" FOREIGN KEY ("installationId", "workspaceId") REFERENCES "GitHubInstallation"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;


ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_sha" CHECK ("commitSha" ~ '^[a-f0-9]{40}$' OR "commitSha" ~ '^[a-f0-9]{64}$');
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_progress" CHECK ("progress" BETWEEN 0 AND 100);
ALTER TABLE "ImportJob" ALTER CONSTRAINT "ImportJob_snapshotId_repositoryId_workspaceId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Repository" ALTER CONSTRAINT "Repository_installationId_workspaceId_fkey" DEFERRABLE INITIALLY DEFERRED;
