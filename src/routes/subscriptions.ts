import { Router, Response } from 'express';
import { z } from 'zod';
import auth, { AuthRequest } from '@/middleware/auth';
import role from '@/middleware/role';
import validate from '@/middleware/validate';
import verifyClickPesaWebhook from '@/middleware/verifyweebhook';
import * as subscriptionService from '@/services/subscriptions.service';

const router = Router();

const planIdSchema = z.object({ id: z.string().uuid() });

const createPlanSchema = z.object({
  name: z.string().min(1),
  ClickpesaPriceId: z.string().min(1),
  priceCents: z.number().int().positive(),
  billingInterval: z.enum(['month', 'year']),
  minOrderAmountCents: z.number().int().nonnegative().optional(),
  freeDelivery: z.boolean().optional(),
  discountPercentage: z.number().min(0).max(100).optional(),
  isTrialPlan: z.boolean().optional(),
  trialDays: z.number().int().nonnegative().optional(),
  maxMenuItems: z.number().int().positive().optional(),
  hasAnalytics: z.boolean().optional(),
  hasOnlinePayments: z.boolean().optional(),
  priorityPlacement: z.boolean().optional(),
  featuredInPopular: z.boolean().optional(),
  customDesign: z.boolean().optional(),
  multiBranch: z.boolean().optional(),
  dedicatedManager: z.boolean().optional(),
});

const updatePlanSchema = z.object({
  name: z.string().min(1).optional(),
  ClickpesaPriceId: z.string().min(1).optional(),
  priceCents: z.number().int().positive().optional(),
  billingInterval: z.enum(['month', 'year']).optional(),
  minOrderAmountCents: z.number().int().nonnegative().optional(),
  freeDelivery: z.boolean().optional(),
  discountPercentage: z.number().min(0).max(100).optional(),
  isTrialPlan: z.boolean().optional(),
  trialDays: z.number().int().nonnegative().optional(),
  maxMenuItems: z.number().int().positive().optional(),
  hasAnalytics: z.boolean().optional(),
  hasOnlinePayments: z.boolean().optional(),
  priorityPlacement: z.boolean().optional(),
  featuredInPopular: z.boolean().optional(),
  customDesign: z.boolean().optional(),
  multiBranch: z.boolean().optional(),
  dedicatedManager: z.boolean().optional(),
});

const createSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  phoneNumber: z.string().min(10).max(15),
});

router.get('/plans', async (_req, res: Response): Promise<void> => {
  try {
    const plans = await subscriptionService.listPlans();
    res.json({ success: true, data: plans });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch plans' });
  }
});

router.get('/plans/:id', validate(planIdSchema, 'params'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const plan = await subscriptionService.getPlan(req.params.id as string);
    if (!plan) {
      res.status(404).json({ success: false, message: 'Plan not found' });
      return;
    }
    res.json({ success: true, data: plan });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch plan' });
  }
});

router.post('/plans',auth,role('admin'),validate(createPlanSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const plan = await subscriptionService.createPlan(req.body);
      res.status(201).json({ success: true, data: plan });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to create plan' });
    }
  },
);

router.put(
  '/plans/:id',
  auth,
  role('admin'),
  validate(updatePlanSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const plan = await subscriptionService.updatePlan(req.params.id as string, req.body);
      res.json({ success: true, data: plan });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to update plan' });
    }
  },
);

router.delete(
  '/plans/:id',
  auth,
  role('admin'),
  validate(planIdSchema, 'params'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      await subscriptionService.deletePlan(req.params.id as string);
      res.json({ success: true, message: 'Plan deleted' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to delete plan' });
    }
  },
);

router.get('/my', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subscriptions = await subscriptionService.getUserSubscriptions(req.userId!);
    res.json({ success: true, data: subscriptions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch subscriptions' });
  }
});

router.get('/my/active', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subscription = await subscriptionService.getActiveSubscription(req.userId!);
    res.json({ success: true, data: subscription });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch active subscription' });
  }
});

router.post('/start-trial', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subscription = await subscriptionService.startTrial(req.userId!);
    res.status(201).json({ success: true, message: 'Trial started', data: subscription });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to start trial' });
  }
});

router.post(
  '/upgrade',
  auth,
  validate(createSubscriptionSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await subscriptionService.upgradeFromTrial(req.userId!, req.body);
      res.status(201).json({ success: true, message: 'Upgrade initiated', data: result });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message || 'Failed to upgrade' });
    }
  },
);

router.post(
  '/subscribe',
  auth,
  validate(createSubscriptionSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await subscriptionService.createSubscription(req.userId!, req.body);
      res.status(201).json({ success: true, message: 'Subscription initiated', data: result });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message || 'Failed to create subscription' });
    }
  },
);

router.post(
  '/cancel/:id',
  auth,
  validate(planIdSchema, 'params'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const subscription = await subscriptionService.cancelSubscription(req.userId!, req.params.id as string);
      res.json({ success: true, message: 'Subscription cancelled', data: subscription });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message || 'Failed to cancel subscription' });
    }
  },
);

router.get('/check-limit/:feature', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const feature = req.params.feature as string;
    const result = await subscriptionService.checkPlanLimit(req.userId!, feature);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to check plan limit' });
  }
});

export const clickPesaSubscriptionWebhookRouter = Router();
clickPesaSubscriptionWebhookRouter.post(
  '/webhook',
  verifyClickPesaWebhook,
  async (req: any, res: Response): Promise<void> => {
    try {
      const { event, data } = req.body;
      await subscriptionService.handleClickPesaWebhook(event, data);
      res.status(200).json({ success: true, message: 'Webhook processed' });
    } catch (error) {
      console.error('Subscription webhook error:', error);
      res.status(200).json({ success: true, message: 'Webhook acknowledged' });
    }
  },
);

export default router;
