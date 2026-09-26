import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '@/db/prisma';
import { AuthRequest } from '@/middleware/auth';
import auth from '@/middleware/auth';
import validate from '@/middleware/validate';
import verifyClickPesaWebhook from '@/middleware/verifyweebhook';
import { initiateUSSDPush } from '@/services/payment.service';
import { EntryDirection, TransactionStatus } from '@prisma/client';
import { MAX_WALLET_AMOUNT } from '../services/wallet.service';

const router = Router();

const checkoutSchema = z.object({
  orderId: z.string().uuid(),
  amount: z.number().positive(),
  phoneNumber: z.string().min(10).max(15),
  currency: z.string().default('TZS'),
});

router.post('/checkout', auth, validate(checkoutSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { orderId, amount, phoneNumber, currency } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    if (order.userId !== req.userId) {
      res.status(403).json({ success: false, message: 'Not authorized to pay for this order' });
      return;
    }

    const existingTransaction = await prisma.transaction.findFirst({
      where: { orderId, status: 'PENDING' },
    });
    if (existingTransaction) {
      res.status(409).json({ success: false, message: 'A pending payment already exists for this order' });
      return;
    }

    const orderReference = `PIKI${order.orderNumber.replace(/[^A-Za-z0-9]/g, '')}${Date.now().toString().slice(-4)}`;

    const clickPesaResponse = await initiateUSSDPush({
      amount,
      orderReference,
      phoneNumber,
      currency,
    });

    const transaction = await prisma.transaction.create({
      data: {
        orderReference,
        orderId,
        clickPesaId: clickPesaResponse.id || null,
        amount,
        phoneNumber,
        status: 'PENDING',
      },
    });

    await prisma.order.update({
      where: { id: orderId },
      data: { paymentIntentId: transaction.id },
    });

    res.status(200).json({
      success: true,
      message: 'Payment initiated',
      data: {
        transaction,
        clickPesa: clickPesaResponse,
      },
    });
  } catch (error: any) {
    const detail = error?.response?.data?.message || error?.message || 'Payment processing failed';
    console.error('Checkout error:', error?.response?.data || error.message || error);
    res.status(500).json({ success: false, message: 'Payment processing failed', error: detail });
  }
});

router.get('/transaction/:orderReference', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const orderReference = req.params.orderReference as string;
    const transaction = await prisma.transaction.findUnique({
      where: { orderReference },
      include: {
        wallet: {
          select: {
            driverId: true,
            restaurant: { select: { ownerId: true } },
          },
        },
        order: {
          select: {
            userId: true,
            riderId: true,
            restaurant: { select: { ownerId: true } },
          },
        },
      },
    });

    if (!transaction) {
      res.status(404).json({ success: false, message: 'Transaction not found' });
      return;
    }

    const isAdmin = req.userRole === 'admin';
    const isWalletOwner =
      transaction.wallet?.driverId === req.userId ||
      transaction.wallet?.restaurant?.ownerId === req.userId;
    const isOrderParticipant =
      transaction.order?.userId === req.userId ||
      transaction.order?.riderId === req.userId ||
      transaction.order?.restaurant.ownerId === req.userId;
    if (!isAdmin && !isWalletOwner && !isOrderParticipant) {
      res.status(404).json({ success: false, message: 'Transaction not found' });
      return;
    }

    res.json({ success: true, data: transaction });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch transaction' });
  }
});

export const clickPesaWebhookRouter = Router();
// this is the webhook route that is being exposed to our
clickPesaWebhookRouter.post('/webhook', verifyClickPesaWebhook, async (req: any, res: Response): Promise<void> => {
  try {
    const { event, data } = req.body;

    if (!data?.orderReference) {
      res.status(200).json({ success: true, message: 'No orderReference, skipping' });
      return;
    }

    const transaction = await prisma.transaction.findUnique({
      where: { orderReference: data.orderReference },
    });

    if (!transaction) {
      console.error(`Webhook: transaction not found for orderReference ${data.orderReference}`);
      res.status(200).json({ success: true, message: 'Transaction not found' });
      return;
    }

    if (event === 'PAYMENT RECEIVED' && data.status === 'SUCCESS') {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.transaction.updateMany({
          where: { id: transaction.id, status: TransactionStatus.PENDING },
          data: { status: TransactionStatus.SUCCESSFUL },
        });
        if (claimed.count !== 1) return;

        if (transaction.type === 'TOP_UP') {
          const amountInCents = Math.round(transaction.amount * 100);
          if (
            !transaction.walletId ||
            !Number.isSafeInteger(amountInCents) ||
            amountInCents <= 0 ||
            amountInCents > MAX_WALLET_AMOUNT
          ) {
            throw new Error('Wallet top-up transaction is invalid');
          }

          const credited = await tx.wallet.updateMany({
            where: {
              id: transaction.walletId,
              status: 'ACTIVE',
              balance: { lte: MAX_WALLET_AMOUNT - amountInCents },
            },
            data: { balance: { increment: amountInCents } },
          });
          if (credited.count !== 1) throw new Error('Unable to credit wallet top-up');

          await tx.ledgerEntry.create({
            data: {
              transactionId: transaction.id,
              walletId: transaction.walletId,
              amount: amountInCents,
              direction: EntryDirection.CREDIT,
            },
          });
        }

        if (transaction.orderId) {
          await tx.order.update({
            where: { id: transaction.orderId },
            data: { paymentIntentId: transaction.id },
          });
        }
      });
    } else if (event === 'PAYMENT FAILED') {
      await prisma.transaction.updateMany({
        where: { id: transaction.id, status: TransactionStatus.PENDING },
        data: { status: TransactionStatus.FAILED },
      });
    }

    res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ success: false, message: 'Webhook processing failed' });
  }
});

export default router;
