import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '@/db/prisma';
import { AuthRequest } from '@/middleware/auth';
import auth from '@/middleware/auth';
import validate from '@/middleware/validate';
import verifyClickPesaWebhook from '@/middleware/verifyweebhook';
import { initiateUSSDPush } from '@/services/payment.service';
import { TransactionStatus } from '@prisma/client';

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
    });

    if (!transaction) {
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
      if (transaction.status !== 'SUCCESSFUL') {
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: 'SUCCESSFUL' },
        });

        if (transaction.orderId) {
          await prisma.order.update({
            where: { id: transaction.orderId },
            data: { paymentIntentId: transaction.id },
          });
        }
      }
    } else if (event === 'PAYMENT FAILED') {
      if (transaction.status !== 'FAILED') {
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: 'FAILED' },
        });
      }
    }

    res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(200).json({ success: true, message: 'Webhook acknowledged' });
  }
});

export default router;
