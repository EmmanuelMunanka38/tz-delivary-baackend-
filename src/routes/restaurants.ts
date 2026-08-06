import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../db/prisma';
import auth, { AuthRequest } from '../middleware/auth';
import role from '../middleware/role';
import validate from '../middleware/validate';
import { storage } from '../services/storage.service';

const router = Router();

const getUploadKeyFromUrl = (url?: string | null) => {
  if (!url) return null;
  const marker = '/uploads/';
  const markerIndex = url.indexOf(marker);
  if (markerIndex === -1) return null;
  return url.slice(markerIndex + marker.length).split('?')[0] || null;
};

const createRestaurantSchema = z.object({
  name: z.string().min(1),
  image: z.string().min(1),
  logo: z.string().optional(),
  cuisine: z.string().min(1),
  deliveryFee: z.number().min(0),
  deliveryTime: z.string().min(1),
  distance: z.string().min(1),
  address: z.string().min(1),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  isApproved: z.boolean().optional(),
});

const updateRestaurantSchema = z.object({
  name: z.string().min(1).optional(),
  image: z.string().optional(),
  logo: z.string().optional(),
  cuisine: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  ratingCount: z.number().min(0).optional(),
  deliveryFee: z.number().min(0).optional(),
  deliveryTime: z.string().optional(),
  distance: z.string().optional(),
  address: z.string().optional(),
  isOpen: z.boolean().optional(),
  customMessage: z.string().optional(),
  nextOpenTime: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

const createMenuItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().min(0),
  image: z.string().optional(),
  category: z.string().min(1),
  isAvailable: z.boolean().optional(),
  isPopular: z.boolean().optional(),
});

const updateMenuItemSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  price: z.number().min(0).optional(),
  image: z.string().optional(),
  category: z.string().optional(),
  isAvailable: z.boolean().optional(),
  isPopular: z.boolean().optional(),
});

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cuisine, search, isOpen, ownerId } = req.query;
    const where: any = {};

    // Public listing: show only approved restaurants
    // If ownerId is provided, show that owner's restaurants regardless of approval
    if (ownerId) {
      where.ownerId = ownerId as string;
    } else {
      where.isApproved = true;
    }

    if (cuisine) {
      where.cuisine = { contains: cuisine as string, mode: 'insensitive' };
    }
    if (search) {
      where.name = { contains: search as string, mode: 'insensitive' };
    }
    if (isOpen !== undefined) {
      where.isOpen = isOpen === 'true';
    }

    const restaurants = await prisma.restaurant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: restaurants });
  } catch (error) {
    console.error('Fetch restaurants error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch restaurants' });
  }
});

router.get('/featured', async (_req: Request, res: Response): Promise<void> => {
  try {
    const restaurants = await prisma.restaurant.findMany({
      where: { isApproved: true, isOpen: true },
      orderBy: { rating: 'desc' },
      take: 5,
    });
    res.json({ success: true, data: restaurants });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch featured restaurants' });
  }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: req.params.id as string },
    });

    if (!restaurant) {
      res.status(404).json({ success: false, message: 'Restaurant not found' });
      return;
    }

    const menuItems = await prisma.menuItem.findMany({
      where: { restaurantId: restaurant.id, isAvailable: true },
      orderBy: { category: 'asc' },
    });

    res.json({
      success: true,
      data: { ...restaurant, menu: menuItems },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch restaurant' });
  }
});

router.get('/:id/menu', async (req: Request, res: Response): Promise<void> => {
  try {
    const includeUnavailable = req.query.includeUnavailable === 'true';
    const menuItems = await prisma.menuItem.findMany({
      where: {
        restaurantId: req.params.id as string,
        ...(includeUnavailable ? {} : { isAvailable: true }),
      },
      orderBy: { category: 'asc' },
    });
    res.json({ success: true, data: menuItems });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch menu' });
  }
});

router.post(
  '/',
  auth,
  role('restaurant_owner'),
  validate(createRestaurantSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const restaurant = await prisma.restaurant.create({
        data: { ...req.body, isApproved: true, ownerId: req.userId! },
      });
      res.status(201).json({ success: true, data: restaurant });
    } catch (error) {
      console.error('Create restaurant error:', error);
      res.status(500).json({ success: false, message: 'Failed to create restaurant' });
    }
  },
);

router.put(
  '/:id',
  auth,
  role('restaurant_owner'),
  validate(updateRestaurantSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const restaurant = await prisma.restaurant.findUnique({ where: { id: req.params.id as string } });
      if (!restaurant) {
        res.status(404).json({ success: false, message: 'Restaurant not found' });
        return;
      }
      if (restaurant.ownerId !== req.userId) {
        res.status(403).json({ success: false, message: 'You can only update your own restaurant' });
        return;
      }

      const updated = await prisma.restaurant.update({
        where: { id: req.params.id as string },
        data: req.body,
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to update restaurant' });
    }
  },
);

router.post(
  '/:id/menu',
  auth,
  role('restaurant_owner'),
  validate(createMenuItemSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const restaurant = await prisma.restaurant.findUnique({ where: { id: req.params.id as string } });
      if (!restaurant) {
        res.status(404).json({ success: false, message: 'Restaurant not found' });
        return;
      }
      if (restaurant.ownerId !== req.userId) {
        res.status(403).json({ success: false, message: 'You can only add menu to your own restaurant' });
        return;
      }

      const menuItem = await prisma.menuItem.create({
        data: { ...req.body, restaurantId: req.params.id as string },
      });

      res.status(201).json({ success: true, data: menuItem });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to create menu item' });
    }
  },
);

router.put(
  '/menu/:menuId',
  auth,
  role('restaurant_owner'),
  validate(updateMenuItemSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const menuItem = await prisma.menuItem.findUnique({ where: { id: req.params.menuId as string } });
      if (!menuItem) {
        res.status(404).json({ success: false, message: 'Menu item not found' });
        return;
      }

      const restaurant = await prisma.restaurant.findUnique({ where: { id: menuItem.restaurantId } });
      if (!restaurant || restaurant.ownerId !== req.userId) {
        res.status(403).json({ success: false, message: 'You can only update your own menu items' });
        return;
      }

      const updated = await prisma.menuItem.update({
        where: { id: req.params.menuId as string },
        data: req.body,
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to update menu item' });
    }
  },
);

router.delete(
  '/menu/:menuId',
  auth,
  role('restaurant_owner'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const menuItem = await prisma.menuItem.findUnique({ where: { id: req.params.menuId as string } });
      if (!menuItem) {
        res.status(404).json({ success: false, message: 'Menu item not found' });
        return;
      }

      const restaurant = await prisma.restaurant.findUnique({ where: { id: menuItem.restaurantId } });
      if (!restaurant || restaurant.ownerId !== req.userId) {
        res.status(403).json({ success: false, message: 'You can only delete your own menu items' });
        return;
      }

      await prisma.menuItem.delete({ where: { id: req.params.menuId as string } });

      const uploadKey = getUploadKeyFromUrl(menuItem.image);
      if (uploadKey) {
        storage.delete(uploadKey).catch((error) => {
          console.error('Failed to delete menu item image:', error);
        });
      }

      res.json({ success: true, message: 'Menu item deleted' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to delete menu item' });
    }
  },
);

export default router;
