-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "categories" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "closingHours" TEXT,
ADD COLUMN     "openingHours" TEXT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
