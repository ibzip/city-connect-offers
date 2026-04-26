-- Add user-context intelligence pipeline tables.
-- MockContextProfile stores configured mock raw signal payloads per user, owned by the dev simulator.
-- UserContextAgentRun captures real-LLM agent run metadata for the User Context Assembler and User Negotiator.

PRAGMA foreign_keys=OFF;

CREATE TABLE "MockContextProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabledSourcesJson" TEXT NOT NULL,
    "signalPayloadsJson" TEXT NOT NULL,
    "activeScenario" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "MockContextProfile_userId_idx" ON "MockContextProfile"("userId");
CREATE INDEX "MockContextProfile_userId_isActive_idx" ON "MockContextProfile"("userId", "isActive");

CREATE TABLE "UserContextAgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "contextSnapshotId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "latencyMs" INTEGER,
    "validationStatus" TEXT NOT NULL,
    "errorType" TEXT,
    "outputJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "UserContextAgentRun_userId_createdAt_idx" ON "UserContextAgentRun"("userId", "createdAt");

PRAGMA foreign_keys=ON;
