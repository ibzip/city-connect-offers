-- CreateTable
CREATE TABLE IF NOT EXISTS "MerchantImportRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zoneId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedRadiusMeters" INTEGER NOT NULL,
    "radiusMeters" INTEGER NOT NULL,
    "categoriesJson" TEXT NOT NULL,
    "categoryCapsJson" TEXT NOT NULL,
    "maxImportedMerchants" INTEGER NOT NULL,
    "maxTilesPerRun" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "demoPartnerCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "continuationCursor" TEXT,
    "warningsJson" TEXT NOT NULL,
    "errorJson" TEXT,
    "providerStatsJson" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MerchantImportRun_zoneId_startedAt_idx" ON "MerchantImportRun"("zoneId", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MerchantImportRun_status_idx" ON "MerchantImportRun"("status");
