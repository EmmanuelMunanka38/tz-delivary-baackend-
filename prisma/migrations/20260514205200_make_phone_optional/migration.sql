-- AlterTable: Make phone column optional
ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;
