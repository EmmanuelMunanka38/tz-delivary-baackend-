import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../db/prisma';
import auth, { AuthRequest } from '../middleware/auth';
import { MAX_WALLET_AMOUNT, WalletService } from '../services/wallet.service';
import { WithdrawalService } from '../services/withdraw.service';

const router = Router();

const accountSchema = z.object({
  walletId: z.string().uuid(),
  provider: z.enum(['mpesa', 'tigo_pesa', 'airtel_money', 'mixx_by_yas', 'halopesa']),
  phoneNumber: z.string().trim().regex(/^\+?[1-9]\d{8,14}$/, 'Enter a valid mobile money phone number'),
  accountName: z.string().trim().min(2).max(100),
  isPrimary: z.boolean().optional(),
});

const withdrawalSchema = z.object({
  walletId: z.string().uuid(),
  mobileMoneyAccountId: z.string().uuid(),
  amountInCents: z.number().int().positive().max(MAX_WALLET_AMOUNT),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});

const topUpSchema = z.object({
  walletId: z.string().uuid(),
  amountInCents: z.number().int().positive().max(MAX_WALLET_AMOUNT),
  phoneNumber: z.string().trim().regex(/^\+?[1-9]\d{8,14}$/, 'Enter a valid mobile money phone number'),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(Math.floor(MAX_WALLET_AMOUNT / 100)).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

async function ownedWallet(req: AuthRequest, walletId?: string, restaurantId?: string) {
  if (!req.userId) return null;
  if (req.userRole === 'driver') {
    return prisma.wallet.findFirst({
      where: { id: walletId, driverId: req.userId, ownerType: 'DRIVER' },
    });
  }
  if (req.userRole === 'restaurant_owner') {
    return prisma.wallet.findFirst({
      where: {
        id: walletId,
        ownerType: 'RESTAURANT_OWNER',
        restaurant: { ownerId: req.userId, ...(restaurantId ? { id: restaurantId } : {}) },
      },
    });
  }
  return null;
}

function errorResponse(error: unknown, res: Response) {
  const message = error instanceof Error ? error.message : 'Wallet operation failed';
  if (/idempotency key has already been used/i.test(message)) {
    res.status(409).json({ success: false, message });
    return;
  }
  if (/not belong|insufficient|positive integer|different wallets|cannot receive/i.test(message)) {
    res.status(400).json({ success: false, message });
    return;
  }
  console.error('[Wallet] Operation failed:', error);
  res.status(500).json({ success: false, message: 'Wallet operation failed' });
}

router.use(auth);

router.post('/topups', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const input = topUpSchema.parse(req.body);
    if (!(await ownedWallet(req, input.walletId))) {
      res.status(404).json({ success: false, message: 'Wallet not found' });
      return;
    }
    const result = await WalletService.initiateTopUp({
      ...input,
      idempotencyKey:
        input.idempotencyKey ||
        (typeof req.headers['idempotency-key'] === 'string'
          ? req.headers['idempotency-key']
          : undefined),
    });
    res.status(201).json({
      success: true,
      message: result.clickPesa ? 'Wallet top-up initiated' : 'Wallet top-up already exists',
      data: result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: 'Invalid wallet top-up', errors: error.flatten() });
      return;
    }
    errorResponse(error, res);
  }
});

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const walletId = typeof req.query.walletId === 'string' ? req.query.walletId : undefined;
    const restaurantId = typeof req.query.restaurantId === 'string' ? req.query.restaurantId : undefined;
    if (req.userRole === 'restaurant_owner' && !walletId && !restaurantId) {
      res.status(400).json({ success: false, message: 'restaurantId is required for restaurant owners' });
      return;
    }

    const pagination = paginationSchema.safeParse(req.query);
    if (!pagination.success) {
      res.status(400).json({
        success: false,
        message: 'Invalid pagination parameters',
        errors: pagination.error.flatten(),
      });
      return;
    }

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

    const details = await WalletService.getWalletDetails(
      wallet.id,
      pagination.data.page,
      pagination.data.pageSize,
    );
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
    const withdrawal = await WithdrawalService.requestWithdrawal({
      ...input,
      idempotencyKey:
        input.idempotencyKey ||
        (typeof req.headers['idempotency-key'] === 'string'
          ? req.headers['idempotency-key']
          : undefined),
    });
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
