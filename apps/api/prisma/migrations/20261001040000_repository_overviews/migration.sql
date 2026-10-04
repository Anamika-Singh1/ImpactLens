ALTER TABLE "Repository" ADD COLUMN "description" TEXT, ADD COLUMN "isPrivate" BOOLEAN, ADD COLUMN "defaultBranch" TEXT;
CREATE TABLE "RepositoryOverview" (
  "snapshotId" UUID NOT NULL PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "repositoryId" UUID NOT NULL,
  "version" VARCHAR(30) NOT NULL,
  "data" JSONB NOT NULL,
  "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RepositoryOverview_snapshot_fkey" FOREIGN KEY ("snapshotId", "repositoryId", "workspaceId") REFERENCES "RepositorySnapshot"("id", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RepositoryOverview_workspaceId_repositoryId_idx" ON "RepositoryOverview"("workspaceId", "repositoryId");
