WITH ranked_accounts AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "walletId"
      ORDER BY "isPrimary" DESC, "createdAt" ASC, "id" ASC
    ) AS account_rank
  FROM "MobileMoneyAccount"
)
UPDATE "MobileMoneyAccount" AS account
SET "isPrimary" = (ranked.account_rank = 1)
FROM ranked_accounts AS ranked
WHERE account."id" = ranked."id";

CREATE UNIQUE INDEX "MobileMoneyAccount_one_primary_per_wallet_key"
ON "MobileMoneyAccount" ("walletId")
WHERE "isPrimary" = true;

ALTER TABLE "Wallet"
ADD CONSTRAINT "Wallet_balance_nonnegative_check" CHECK ("balance" >= 0);

ALTER TABLE "LedgerEntry"
ADD CONSTRAINT "LedgerEntry_amount_positive_check" CHECK ("amount" > 0);

ALTER TABLE "WithdrawalRequest"
ADD CONSTRAINT "WithdrawalRequest_amount_positive_check" CHECK ("amount" > 0),
ADD CONSTRAINT "WithdrawalRequest_fee_nonnegative_check" CHECK ("fee" >= 0);

ALTER TABLE "Transaction"
ADD COLUMN "walletId" TEXT;

CREATE INDEX "Transaction_walletId_idx" ON "Transaction"("walletId");

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_walletId_fkey"
FOREIGN KEY ("walletId") REFERENCES "Wallet"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
