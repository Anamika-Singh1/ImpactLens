ALTER TABLE "Workspace" ADD COLUMN "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aiConsentVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "AiExplanation" (
  "workspaceId" UUID NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "cacheKey" CHAR(64) NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("workspaceId", "cacheKey")
);
CREATE TABLE "AiUsage" (
  "workspaceId" UUID NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "day" VARCHAR(10) NOT NULL,
  "requests" INTEGER NOT NULL DEFAULT 0 CHECK ("requests" >= 0),
  "reservedTokens" INTEGER NOT NULL DEFAULT 0 CHECK ("reservedTokens" >= 0),
  PRIMARY KEY ("workspaceId", "day")
);
