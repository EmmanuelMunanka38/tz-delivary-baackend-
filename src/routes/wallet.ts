import { Router, Response } from 'express';
import { PaymentMethod } from '@prisma/client';
import { z } from 'zod';
import prisma from '../db/prisma';
import auth, { AuthRequest } from '../middleware/auth';
import { WalletService } from '../services/wallet.service';
import { WithdrawalService } from '../services/withdraw.service';

const router = Router();

const accountSchema = z.object({
  walletId: z.string().uuid(),
  provider: z.nativeEnum(PaymentMethod),
  phoneNumber: z.string().trim().min(9).max(20),
  accountName: z.string().trim().min(2).max(100),
  isPrimary: z.boolean().optional(),
});

const withdrawalSchema = z.object({
  walletId: z.string().uuid(),
  mobileMoneyAccountId: z.string().uuid(),
  amountInCents: z.number().int().positive(),
});

async function ownedWallet(req: AuthRequest, walletId?: string, restaurantId?: string) {
  if (!req.userId) return null;
  if (req.userRole === 'driver') {
    return prisma.wallet.findFirst({ where: { id: walletId, driverId: req.userId } });
  }
  if (req.userRole === 'restaurant_owner') {
    return prisma.wallet.findFirst({
      where: {
        id: walletId,
        restaurant: { ownerId: req.userId, ...(restaurantId ? { id: restaurantId } : {}) },
      },
    });
  }
  return null;
}

function errorResponse(error: unknown, res: Response) {
  const message = error instanceof Error ? error.message : 'Wallet operation failed';
  const status = /not belong|insufficient|positive integer|different wallets/i.test(message) ? 400 : 500;
  res.status(status).json({ success: false, message });
}

router.use(auth);

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const walletId = typeof req.query.walletId === 'string' ? req.query.walletId : undefined;
    const restaurantId = typeof req.query.restaurantId === 'string' ? req.query.restaurantId : undefined;
    let wallet = await ownedWallet(req, walletId, restaurantId);

    if (!wallet && !walletId) {
      if (req.userRole === 'driver' && req.userId) {
        wallet = await WalletService.createWallet(req.userId, 'DRIVER');
      } else if (req.userRole === 'restaurant_owner' && restaurantId) {
        const restaurant = await prisma.restaurant.findFirst({ where: { id: restaurantId, ownerId: req.userId } });
        if (restaurant) wallet = await WalletService.createWallet(restaurant.id, 'RESTAURANT_OWNER');
      }
    }
    if (!wallet) {
      res.status(404).json({ success: false, message: 'Wallet not found' });
      return;
    }

    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 20);
    const details = await WalletService.getWalletDetails(wallet.id, page, pageSize);
    res.json({ success: true, data: details });
  } catch (error) {
    errorResponse(error, res);
  }
});

router.post('/accounts', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const input = accountSchema.parse(req.body);
    if (!(await ownedWallet(req, input.walletId))) {
      res.status(404).json({ success: false, message: 'Wallet not found' });
      return;
    }
    const account = await WalletService.addMobileMoneyAccount(input);
    res.status(201).json({ success: true, data: account });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: 'Invalid mobile money account', errors: error.flatten() });
      return;
    }
    errorResponse(error, res);
  }
});

router.delete('/accounts/:accountId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const walletId = typeof req.query.walletId === 'string' ? req.query.walletId : '';
    if (!(await ownedWallet(req, walletId))) {
      res.status(404).json({ success: false, message: 'Wallet not found' });
      return;
    }
    const deleted = await WalletService.removeMobileMoneyAccount(walletId, req.params.accountId as string);
    if (deleted.count !== 1) {
      res.status(404).json({ success: false, message: 'Mobile money account not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    errorResponse(error, res);
  }
});

router.get('/withdrawals', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const walletId = typeof req.query.walletId === 'string' ? req.query.walletId : undefined;
    const wallet = await ownedWallet(req, walletId);
    if (!wallet) {
      res.status(404).json({ success: false, message: 'Wallet not found' });
      return;
    }
    const withdrawals = await prisma.withdrawalRequest.findMany({
      where: { walletId: wallet.id },
      include: { mobileMoneyAccount: true, transaction: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: withdrawals });
  } catch (error) {
    errorResponse(error, res);
  }
});

router.post('/withdrawals', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const input = withdrawalSchema.parse(req.body);
    if (!(await ownedWallet(req, input.walletId))) {
      res.status(404).json({ success: false, message: 'Wallet not found' });
      return;
    }
    const withdrawal = await WithdrawalService.requestWithdrawal(input);
    res.status(201).json({ success: true, data: withdrawal });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: 'Invalid withdrawal request', errors: error.flatten() });
      return;
    }
    errorResponse(error, res);
  }
});

export default router;
