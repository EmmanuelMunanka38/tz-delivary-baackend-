import { EntryDirection, WithdrawalStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import prisma from '../db/prisma';
import { MAX_WALLET_AMOUNT } from './wallet.service';

export class WithdrawalService {
  /**
   * Request a mobile money payout
   */
  static async requestWithdrawal(params: {
    walletId: string;
    mobileMoneyAccountId: string;
    amountInCents: number;
    idempotencyKey?: string;
  }) {
    const { walletId, mobileMoneyAccountId, amountInCents } = params;
    const idempotencyKey = params.idempotencyKey?.trim() || randomUUID();
    if (
      !Number.isSafeInteger(amountInCents) ||
      amountInCents <= 0 ||
      amountInCents > MAX_WALLET_AMOUNT
    ) {
      throw new Error(`Amount must be a positive integer no greater than ${MAX_WALLET_AMOUNT}`);
    }

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`withdrawal:${idempotencyKey}`}))`;
      const existing = await tx.transaction.findUnique({
        where: { idempotencyKey: `withdrawal:${idempotencyKey}` },
        include: { withdrawalRequest: true },
      });
      if (existing) {
        const existingWithdrawal = existing.withdrawalRequest;
        if (
          existingWithdrawal?.walletId === walletId &&
          existingWithdrawal.mobileMoneyAccountId === mobileMoneyAccountId &&
          existingWithdrawal.amount === amountInCents
        ) {
          return tx.withdrawalRequest.findUniqueOrThrow({
            where: { id: existingWithdrawal.id },
            include: { mobileMoneyAccount: true },
          });
        }
        throw new Error('Idempotency key has already been used');
      }

      const account = await tx.mobileMoneyAccount.findFirst({
        where: { id: mobileMoneyAccountId, walletId },
      });
      if (!account) throw new Error('Mobile money account does not belong to this wallet');

      const reserved = await tx.wallet.updateMany({
        where: { id: walletId, status: 'ACTIVE', balance: { gte: amountInCents } },
        data: { balance: { decrement: amountInCents } },
      });
      if (reserved.count !== 1) {
        throw new Error('Insufficient balance for withdrawal');
      }

      const transactionId = randomUUID();
      const transaction = await tx.transaction.create({
        data: {
          id: transactionId,
          idempotencyKey: `withdrawal:${idempotencyKey}`,
          orderReference: `WD-${transactionId}`,
          amount: amountInCents / 100,
          phoneNumber: account.phoneNumber,
          status: 'PENDING',
          type: 'WITHDRAWAL',
        },
      });

      const withdrawal = await tx.withdrawalRequest.create({
        data: {
          walletId,
          mobileMoneyAccountId,
          transactionId: transaction.id,
          amount: amountInCents,
          status: WithdrawalStatus.PENDING,
        },
        include: { mobileMoneyAccount: true },
      });

      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          walletId,
          amount: amountInCents,
          direction: EntryDirection.DEBIT,
        },
      });

      return withdrawal;
    });
  }

  /**
   * Webhook Handler: Called by ClickPesa when the payout succeeds/fails
   */
  static async handlePayoutCallback(withdrawalId: string, isSuccessful: boolean, failureReason?: string) {
    return prisma.$transaction(async (tx) => {
      const claimed = await tx.withdrawalRequest.updateMany({
        where: { id: withdrawalId, status: WithdrawalStatus.PENDING },
        data: { status: WithdrawalStatus.PROCESSING },
      });
      if (claimed.count !== 1) return;

      const withdrawal = await tx.withdrawalRequest.findUnique({ where: { id: withdrawalId } });
      if (!withdrawal) return;

      if (isSuccessful) {
        if (withdrawal.transactionId) {
          await tx.transaction.update({
            where: { id: withdrawal.transactionId },
            data: { status: 'SUCCESSFUL' },
          });
        } else {
          const transactionId = randomUUID();
          const transaction = await tx.transaction.create({
            data: {
              id: transactionId,
              idempotencyKey: `legacy-withdrawal:${withdrawal.id}`,
              orderReference: `WD-${transactionId}`,
              amount: withdrawal.amount / 100,
              phoneNumber: '',
              status: 'SUCCESSFUL',
              type: 'WITHDRAWAL',
            },
          });
          await tx.ledgerEntry.create({
            data: {
              transactionId: transaction.id,
              walletId: withdrawal.walletId,
              amount: withdrawal.amount,
              direction: EntryDirection.DEBIT,
            },
          });
          await tx.withdrawalRequest.update({
            where: { id: withdrawalId },
            data: { transactionId: transaction.id },
          });
        }

        await tx.withdrawalRequest.update({
          where: { id: withdrawalId },
          data: { status: WithdrawalStatus.COMPLETED },
        });
      } else {
        const refunded = await tx.wallet.updateMany({
          where: {
            id: withdrawal.walletId,
            balance: { lte: MAX_WALLET_AMOUNT - withdrawal.amount },
          },
          data: { balance: { increment: withdrawal.amount } },
        });
        if (refunded.count !== 1) throw new Error('Unable to refund failed withdrawal');

        const refundId = randomUUID();
        const refundTransaction = await tx.transaction.create({
          data: {
            id: refundId,
            idempotencyKey: `withdrawal-refund:${withdrawal.id}`,
            orderReference: `WR-${refundId}`,
            amount: withdrawal.amount / 100,
            phoneNumber: '',
            status: 'SUCCESSFUL',
            type: 'REFUND',
          },
        });
        await tx.ledgerEntry.create({
          data: {
            transactionId: refundTransaction.id,
            walletId: withdrawal.walletId,
            amount: withdrawal.amount,
            direction: EntryDirection.CREDIT,
          },
        });

        if (withdrawal.transactionId) {
          await tx.transaction.update({
            where: { id: withdrawal.transactionId },
            data: { status: 'FAILED' },
          });
        }

        await tx.withdrawalRequest.update({
          where: { id: withdrawalId },
          data: { status: WithdrawalStatus.FAILED, failureReason: failureReason || 'Payout failed' },
        });
      }
    });
  }
}
