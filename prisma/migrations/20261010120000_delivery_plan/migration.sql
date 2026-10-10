-- AlterTable
ALTER TABLE "DeliveryLog" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'new';
ALTER TABLE "DeliveryLog" ADD COLUMN "cycle" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "DeliveryLog" ADD COLUMN "dayNumber" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryLog" ADD COLUMN "wordIds" TEXT NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "DeliveryLog_userId_mode_date_idx" ON "DeliveryLog"("userId", "mode", "date");
