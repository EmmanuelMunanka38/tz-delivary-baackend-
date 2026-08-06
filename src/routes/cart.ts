import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../db/prisma';
import auth, { AuthRequest } from '../middleware/auth';
import validate from '../middleware/validate';

const router = Router();

const addToCartSchema = z.object({
  restaurantId: z.string().uuid(),
  menuItemId: z.string().uuid(),
  quantity: z.number().int().min(1).default(1),
});

const updateCartItemSchema = z.object({
  quantity: z.number().int().min(0),
});

router.get('/', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    let cart = await prisma.cart.findUnique({
      where: { userId: req.userId },
      include: { items: true },
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId: req.userId! },
        include: { items: true },
      });
    }

    res.json({ success: true, data: cart });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch cart' });
  }
});

router.post('/add', auth, validate(addToCartSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { restaurantId, menuItemId, quantity } = req.body;

    const menuItem = await prisma.menuItem.findUnique({ where: { id: menuItemId } });
    if (!menuItem) {
      res.status(404).json({ success: false, message: 'Menu item not found' });
      return;
    }

    let cart = await prisma.cart.findUnique({
      where: { userId: req.userId },
      include: { items: true },
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId: req.userId!, restaurantId },
        include: { items: true },
      });
    } else if (cart.restaurantId !== restaurantId && cart.items.length > 0) {
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
      await prisma.cart.update({
        where: { id: cart.id },
        data: { restaurantId },
      });
    } else if (!cart.restaurantId) {
      await prisma.cart.update({
        where: { id: cart.id },
        data: { restaurantId },
      });
    }

    const existingItem = await prisma.cartItem.findFirst({
      where: { cartId: cart.id, menuItemId },
    });

    if (existingItem) {
      await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + quantity },
      });
    } else {
      await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          menuItemId,
          quantity,
          price: menuItem.price,
          name: menuItem.name,
        },
      });
    }

    const updatedCart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: { items: true },
    });

    res.json({ success: true, data: updatedCart });
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ success: false, message: 'Failed to add item to cart' });
  }
});

router.put('/items/:itemId', auth, validate(updateCartItemSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cartItem = await prisma.cartItem.findUnique({
      where: { id: req.params.itemId as string },
      include: { cart: true },
    });

    if (!cartItem || cartItem.cart.userId !== req.userId) {
      res.status(404).json({ success: false, message: 'Cart item not found' });
      return;
    }

    if (req.body.quantity === 0) {
      await prisma.cartItem.delete({ where: { id: req.params.itemId as string } });
    } else {
      await prisma.cartItem.update({
        where: { id: req.params.itemId as string },
        data: { quantity: req.body.quantity },
      });
    }

    const cart = await prisma.cart.findUnique({
      where: { id: cartItem.cartId },
      include: { items: true },
    });

    res.json({ success: true, data: cart });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update cart item' });
  }
});

router.delete('/items/:itemId', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cartItem = await prisma.cartItem.findUnique({
      where: { id: req.params.itemId as string },
      include: { cart: true },
    });

    if (!cartItem || cartItem.cart.userId !== req.userId) {
      res.status(404).json({ success: false, message: 'Cart item not found' });
      return;
    }

    await prisma.cartItem.delete({ where: { id: req.params.itemId as string } });

    const cart = await prisma.cart.findUnique({
      where: { id: cartItem.cartId },
      include: { items: true },
    });

    res.json({ success: true, data: cart });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to remove cart item' });
  }
});

router.delete('/', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cart = await prisma.cart.findUnique({ where: { userId: req.userId } });
    if (cart) {
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
      await prisma.cart.update({
        where: { id: cart.id },
        data: { restaurantId: null },
      });
    }
    res.json({ success: true, message: 'Cart cleared' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to clear cart' });
  }
});

export default router;
