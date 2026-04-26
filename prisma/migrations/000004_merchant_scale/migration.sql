PRAGMA foreign_keys=OFF;

DROP TABLE IF EXISTS "Merchant_next";

CREATE TABLE "Merchant_next" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT '',
    "zoneId" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "participationStatus" TEXT NOT NULL DEFAULT 'partner',
    "source" TEXT NOT NULL DEFAULT 'seeded',
    "latitude" REAL,
    "longitude" REAL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT OR REPLACE INTO "Merchant_next" (
    "id",
    "name",
    "zoneId",
    "category",
    "participationStatus",
    "source",
    "latitude",
    "longitude",
    "data",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    COALESCE(json_extract("data", '$.name'), ''),
    COALESCE(json_extract("data", '$.zoneId'), ''),
    COALESCE(json_extract("data", '$.category'), ''),
    COALESCE(json_extract("data", '$.participationStatus'), 'partner'),
    COALESCE(json_extract("data", '$.source'), 'seeded'),
    json_extract("data", '$.latitude'),
    json_extract("data", '$.longitude'),
    "data",
    "createdAt",
    "updatedAt"
FROM "Merchant";

DROP TABLE "Merchant";
ALTER TABLE "Merchant_next" RENAME TO "Merchant";

CREATE INDEX IF NOT EXISTS "Merchant_zoneId_idx" ON "Merchant"("zoneId");
CREATE INDEX IF NOT EXISTS "Merchant_category_idx" ON "Merchant"("category");
CREATE INDEX IF NOT EXISTS "Merchant_participationStatus_idx" ON "Merchant"("participationStatus");
CREATE INDEX IF NOT EXISTS "Merchant_source_idx" ON "Merchant"("source");

PRAGMA foreign_keys=ON;
