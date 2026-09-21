import { EntryDirection, PaymentMethod, WalletTransactionType } from '@prisma/client';
import prisma from '../db/prisma';

export class WalletService {
  /**
   * Auto-create a wallet when a driver or restaurant owner is created/approved
   */
  static async createWallet(ownerId: string, ownerType: 'DRIVER' | 'RESTAURANT_OWNER') {
    const where = ownerType === 'DRIVER' ? { driverId: ownerId } : { restaurantId: ownerId };
    return prisma.wallet.upsert({
      where,
      create: {
        ownerType,
        currency: 'TZS',
        ...where,
      },
      update: {},
    });
  }

  /**
   * Get wallet summary (balance & recent transactions)
   */
  static async getWalletDetails(walletId: string, page = 1, pageSize = 20) {
    const take = Math.min(Math.max(pageSize, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;
    return prisma.wallet.findUnique({
      where: { id: walletId },
      include: {
        mobileMoneyAccounts: true,
        ledgerEntries: {
          take,
          skip,
          orderBy: { createdAt: 'desc' },
          include: { transaction: true },
        },
      },
    });
  }

  static async addMobileMoneyAccount(params: {
    walletId: string;
    provider: PaymentMethod;
    phoneNumber: string;
    accountName: string;
    isPrimary?: boolean;
  }) {
    return prisma.$transaction(async (tx) => {
      if (params.isPrimary !== false) {
        await tx.mobileMoneyAccount.updateMany({
          where: { walletId: params.walletId },
          data: { isPrimary: false },
        });
      }
      return tx.mobileMoneyAccount.create({ data: { ...params, isPrimary: params.isPrimary !== false } });
    });
  }

  static async removeMobileMoneyAccount(walletId: string, accountId: string) {
    return prisma.mobileMoneyAccount.deleteMany({ where: { id: accountId, walletId } });
  }

  /**
   * Core Transfer Method: Executes atomic double-entry money movements
   */
  static async recordTransfer(params: {
    sourceWalletId: string;
    destinationWalletId: string;
    amountInCents: number;
    type: WalletTransactionType;
    orderId?: string;
    idempotencyKey: string;
  }) {
    const { sourceWalletId, destinationWalletId, amountInCents, type, orderId, idempotencyKey } = params;
    if (!Number.isSafeInteger(amountInCents) || amountInCents <= 0) {
      throw new Error('Amount must be a positive integer');
    }
    if (sourceWalletId === destinationWalletId) {
      throw new Error('Source and destination wallets must be different');
    }

    return prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findUnique({ where: { idempotencyKey } });
      if (existing) return existing;

      // Conditional update prevents two concurrent transfers from overspending the wallet.
      const debited = await tx.wallet.updateMany({
        where: { id: sourceWalletId, status: 'ACTIVE', balance: { gte: amountInCents } },
        data: { balance: { decrement: amountInCents } },
      });
      if (debited.count !== 1) {
        throw new Error('Insufficient wallet balance');
      }

      const transaction = await tx.transaction.create({
        data: {
          idempotencyKey,
          orderId,
          amount: amountInCents / 100, // Storing display float for transaction view
          phoneNumber: '',
          type,
          status: 'SUCCESSFUL',
          orderReference: `TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          walletId: sourceWalletId,
          amount: amountInCents,
          direction: EntryDirection.DEBIT,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          walletId: destinationWalletId,
          amount: amountInCents,
          direction: EntryDirection.CREDIT,
        },
      });

      await tx.wallet.update({
        where: { id: destinationWalletId },
        data: { balance: { increment: amountInCents } },
      });

      return transaction;
    });
  }
}
