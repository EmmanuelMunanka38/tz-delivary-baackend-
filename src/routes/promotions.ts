import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../db/prisma';
import auth, { AuthRequest } from '../middleware/auth';
import role from '../middleware/role';
import validate from '../middleware/validate';

const router = Router();

const createPromotionSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  code: z.string().optional(),
  image: z.string().optional(),
  ctaLabel: z.string().optional(),
  isActive: z.boolean().optional(),
  restaurantId: z.string().optional(),
});

const updatePromotionSchema = createPromotionSchema.partial();

const canManagePromotion = async (promotion: any, req: AuthRequest): Promise<boolean> => {
  if (promotion.restaurantId) {
    if (req.userRole === 'admin') return true;
    const restaurant = await prisma.restaurant.findUnique({ where: { id: promotion.restaurantId } });
    return !!restaurant && restaurant.ownerId === req.userId;
  }
  return req.userRole === 'admin';
};

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId, includeInactive } = req.query;
    const where: any = {};
    if (restaurantId) {
      where.restaurantId = restaurantId as string;
    }
    if (includeInactive !== 'true') {
      where.isActive = true;
    }

    const promotions = await prisma.promotion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: promotions });
  } catch (error) {
    console.error('Fetch promotions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch promotions' });
  }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const promotion = await prisma.promotion.findUnique({
      where: { id: req.params.id as string },
    });

    if (!promotion) {
      res.status(404).json({ success: false, message: 'Promotion not found' });
      return;
    }

    res.json({ success: true, data: promotion });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch promotion' });
  }
});

router.post(
  '/',
  auth,
  role('restaurant_owner', 'admin'),
  validate(createPromotionSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { restaurantId } = req.body;

      if (restaurantId) {
        const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId as string } });
        if (!restaurant || (restaurant.ownerId !== req.userId && req.userRole !== 'admin')) {
          res.status(403).json({ success: false, message: 'You can only add promotions to your own restaurant' });
          return;
        }
      } else if (req.userRole !== 'admin') {
        res.status(403).json({ success: false, message: 'Only admins can create global promotions' });
        return;
      }

      const promotion = await prisma.promotion.create({ data: req.body });

      res.status(201).json({ success: true, data: promotion });
    } catch (error) {
      console.error('Create promotion error:', error);
      res.status(500).json({ success: false, message: 'Failed to create promotion' });
    }
  },
);

router.put(
  '/:id',
  auth,
  role('restaurant_owner', 'admin'),
  validate(updatePromotionSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const promotion = await prisma.promotion.findUnique({ where: { id: req.params.id as string } });
      if (!promotion) {
        res.status(404).json({ success: false, message: 'Promotion not found' });
        return;
      }

      if (!(await canManagePromotion(promotion, req))) {
        res.status(403).json({ success: false, message: 'You can only update your own promotions' });
        return;
      }

      const updated = await prisma.promotion.update({
        where: { id: req.params.id as string },
        data: req.body,
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Update promotion error:', error);
      res.status(500).json({ success: false, message: 'Failed to update promotion' });
    }
  },
);

router.delete(
  '/:id',
  auth,
  role('restaurant_owner', 'admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const promotion = await prisma.promotion.findUnique({ where: { id: req.params.id as string } });
      if (!promotion) {
        res.status(404).json({ success: false, message: 'Promotion not found' });
        return;
      }

      if (!(await canManagePromotion(promotion, req))) {
        res.status(403).json({ success: false, message: 'You can only delete your own promotions' });
        return;
      }

      await prisma.promotion.delete({ where: { id: req.params.id as string } });

      res.json({ success: true, message: 'Promotion deleted' });
    } catch (error) {
      console.error('Delete promotion error:', error);
      res.status(500).json({ success: false, message: 'Failed to delete promotion' });
    }
  },
);

export default router;
