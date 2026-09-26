import { EntryDirection, PaymentMethod, WalletTransactionType } from '@prisma/client';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import prisma from '../db/prisma';
import { initiateUSSDPush } from './payment.service';

export const MAX_WALLET_AMOUNT = 2_147_483_647;

const assertValidAmount = (amount: number): void => {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_WALLET_AMOUNT) {
    throw new Error(`Amount must be a positive integer no greater than ${MAX_WALLET_AMOUNT}`);
  }
};

export class WalletService {
  static async initiateTopUp(params: {
    walletId: string;
    amountInCents: number;
    phoneNumber: string;
    idempotencyKey?: string;
  }) {
    const { walletId, amountInCents, phoneNumber } = params;
    assertValidAmount(amountInCents);
    const requestKey = params.idempotencyKey?.trim() || randomUUID();
    if (requestKey.length > 128) throw new Error('Idempotency key must be at most 128 characters');

    const existing = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet-topup:${requestKey}`}))`;
      const previous = await tx.transaction.findUnique({
        where: { idempotencyKey: `wallet-topup:${requestKey}` },
      });
      if (previous) {
        if (
          previous.walletId === walletId &&
          previous.type === 'TOP_UP' &&
          previous.amount === amountInCents / 100 &&
          previous.phoneNumber === phoneNumber
        ) {
          return { transaction: previous, alreadyExists: true };
        }
        throw new Error('Idempotency key has already been used');
      }

      const wallet = await tx.wallet.findUnique({
        where: { id: walletId },
        select: { id: true, status: true },
      });
      if (!wallet || wallet.status !== 'ACTIVE') throw new Error('Wallet not found or not active');

      return {
        transaction: await tx.transaction.create({
          data: {
            walletId,
            idempotencyKey: `wallet-topup:${requestKey}`,
            orderReference: `WT-${randomUUID()}`,
            amount: amountInCents / 100,
            phoneNumber,
            type: 'TOP_UP',
            status: 'PENDING',
          },
        }),
        alreadyExists: false,
      };
    });

    if (existing.alreadyExists || existing.transaction.status !== 'PENDING') {
      return { transaction: existing.transaction, clickPesa: null };
    }

    try {
      const clickPesa = await initiateUSSDPush({
        amount: existing.transaction.amount,
        orderReference: existing.transaction.orderReference,
        phoneNumber,
        currency: 'TZS',
      });
      const transaction = await prisma.transaction.update({
        where: { id: existing.transaction.id },
        data: { clickPesaId: clickPesa.id || null },
      });
      return { transaction, clickPesa };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response && error.response.status >= 400 && error.response.status < 500) {
        await prisma.transaction.updateMany({
          where: { id: existing.transaction.id, status: 'PENDING' },
          data: { status: 'FAILED' },
        });
      }
      throw error;
    }
  }

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
    const take = Number.isSafeInteger(pageSize) ? Math.min(Math.max(pageSize, 1), 100) : 20;
    const requestedPage = Number.isSafeInteger(page) ? Math.max(page, 1) : 1;
    const skip = Math.min((requestedPage - 1) * take, MAX_WALLET_AMOUNT);
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
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${params.walletId}))`;

      const existingPrimary = await tx.mobileMoneyAccount.findFirst({
        where: { walletId: params.walletId, isPrimary: true },
        select: { id: true },
      });
      const makePrimary = params.isPrimary !== false || !existingPrimary;

      if (makePrimary) {
        await tx.mobileMoneyAccount.updateMany({
          where: { walletId: params.walletId },
          data: { isPrimary: false },
        });
      }
      return tx.mobileMoneyAccount.create({ data: { ...params, isPrimary: makePrimary } });
    });
  }

  static async removeMobileMoneyAccount(walletId: string, accountId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${walletId}))`;
      const account = await tx.mobileMoneyAccount.findFirst({
        where: { id: accountId, walletId },
        select: { id: true, isPrimary: true },
      });
      if (!account) return { count: 0 };

      const deleted = await tx.mobileMoneyAccount.deleteMany({ where: { id: account.id, walletId } });
      if (account.isPrimary && deleted.count === 1) {
        const replacement = await tx.mobileMoneyAccount.findFirst({
          where: { walletId },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (replacement) {
          await tx.mobileMoneyAccount.update({
            where: { id: replacement.id },
            data: { isPrimary: true },
          });
        }
      }
      return deleted;
    });
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
    assertValidAmount(amountInCents);
    if (!idempotencyKey.trim()) throw new Error('Idempotency key is required');
    const normalizedIdempotencyKey = idempotencyKey.trim();
    if (sourceWalletId === destinationWalletId) {
      throw new Error('Source and destination wallets must be different');
    }

    return prisma.$transaction(async (tx) => {
      const walletIds = [sourceWalletId, destinationWalletId].sort();
      for (const walletId of walletIds) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${walletId}))`;
      }
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`transfer:${normalizedIdempotencyKey}`}))`;

      const existing = await tx.transaction.findUnique({
        where: { idempotencyKey: normalizedIdempotencyKey },
      });
      if (existing) {
        const entries = await tx.ledgerEntry.findMany({
          where: { transactionId: existing.id },
          select: { walletId: true, amount: true, direction: true },
        });
        const isSameTransfer =
          existing.status === 'SUCCESSFUL' &&
          existing.type === type &&
          existing.orderId === (orderId ?? null) &&
          existing.amount === amountInCents / 100 &&
          entries.length === 2 &&
          entries.some(
            (entry) =>
              entry.walletId === sourceWalletId &&
              entry.amount === amountInCents &&
              entry.direction === EntryDirection.DEBIT,
          ) &&
          entries.some(
            (entry) =>
              entry.walletId === destinationWalletId &&
              entry.amount === amountInCents &&
              entry.direction === EntryDirection.CREDIT,
          );
        if (!isSameTransfer) throw new Error('Idempotency key has already been used');
        return existing;
      }

      const destinationWallet = await tx.wallet.findUnique({
        where: { id: destinationWalletId },
        select: { id: true, status: true },
      });
      if (!destinationWallet || destinationWallet.status !== 'ACTIVE') {
        throw new Error('Destination wallet not found or not active');
      }

      // Conditional update prevents two concurrent transfers from overspending the wallet.
      const debited = await tx.wallet.updateMany({
        where: { id: sourceWalletId, status: 'ACTIVE', balance: { gte: amountInCents } },
        data: { balance: { decrement: amountInCents } },
      });
      if (debited.count !== 1) {
        throw new Error('Insufficient wallet balance');
      }

      const credited = await tx.wallet.updateMany({
        where: {
          id: destinationWalletId,
          status: 'ACTIVE',
          balance: { lte: MAX_WALLET_AMOUNT - amountInCents },
        },
        data: { balance: { increment: amountInCents } },
      });
      if (credited.count !== 1) {
        throw new Error('Destination wallet cannot receive this transfer');
      }

      const transaction = await tx.transaction.create({
        data: {
          idempotencyKey: normalizedIdempotencyKey,
          orderId,
          amount: amountInCents / 100,
          phoneNumber: '',
          type,
          status: 'SUCCESSFUL',
          orderReference: `TX-${randomUUID()}`,
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

      return transaction;
    });
  }
}
