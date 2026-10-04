CREATE TABLE "StaticGraph" (
    "snapshotId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "version" VARCHAR(30) NOT NULL,
    "graph" JSONB NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaticGraph_pkey" PRIMARY KEY ("snapshotId"),
    CONSTRAINT "StaticGraph_snapshot_fkey" FOREIGN KEY ("snapshotId", "repositoryId", "workspaceId")
      REFERENCES "RepositorySnapshot" ("id", "repositoryId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "StaticGraph_workspaceId_repositoryId_idx" ON "StaticGraph" ("workspaceId", "repositoryId");
CREATE UNIQUE INDEX "StaticGraph_snapshotId_repositoryId_workspaceId_key" ON "StaticGraph" ("snapshotId", "repositoryId", "workspaceId");
