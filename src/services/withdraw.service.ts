import { EntryDirection, WithdrawalStatus } from '@prisma/client';
import prisma from '../db/prisma';

export class WithdrawalService {
  /**
   * Request a mobile money payout
   */
  static async requestWithdrawal(params: { walletId: string; mobileMoneyAccountId: string; amountInCents: number }) {
    const { walletId, mobileMoneyAccountId, amountInCents } = params;
    if (!Number.isSafeInteger(amountInCents) || amountInCents <= 0) {
      throw new Error('Amount must be a positive integer');
    }

    return prisma.$transaction(async (tx) => {
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

      const withdrawal = await tx.withdrawalRequest.create({
        data: {
          walletId,
          mobileMoneyAccountId,
          amount: amountInCents,
          status: WithdrawalStatus.PENDING,
        },
        include: { mobileMoneyAccount: true },
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
        const transaction = await tx.transaction.create({
          data: {
            idempotencyKey: `withdrawal:${withdrawal.id}`,
            orderReference: `WD-${withdrawal.id}`,
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
          data: { status: WithdrawalStatus.COMPLETED, transactionId: transaction.id },
        });
      } else {
        await tx.wallet.update({
          where: { id: withdrawal.walletId },
          data: { balance: { increment: withdrawal.amount } },
        });

        await tx.withdrawalRequest.update({
          where: { id: withdrawalId },
          data: { status: WithdrawalStatus.FAILED, failureReason: failureReason || 'Payout failed' },
        });
      }
    });
  }
}
