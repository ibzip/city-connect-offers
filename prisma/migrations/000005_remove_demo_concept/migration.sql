-- Drop legacy demo concept: the demoPartnerCount column on MerchantImportRun is no longer
-- tracked because every imported merchant is now treated as a real partner with synthetic
-- products/rules/transactions/redemption.
PRAGMA foreign_keys=OFF;

ALTER TABLE "MerchantImportRun" DROP COLUMN "demoPartnerCount";

PRAGMA foreign_keys=ON;
