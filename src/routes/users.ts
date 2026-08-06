import { Router, Response } from 'express';
import prisma from '../db/prisma';
import auth, { AuthRequest } from '../middleware/auth';
import role from '../middleware/role';

const router = Router();

router.get('/', auth, role('admin'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, phone: true, name: true, email: true, avatar: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

router.get('/drivers', auth, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const drivers = await prisma.user.findMany({
      where: { role: 'driver' },
      select: { id: true, name: true, phone: true, avatar: true, createdAt: true },
    });
    res.json({ success: true, data: drivers });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch drivers' });
  }
});

router.put('/role', auth, role('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId, role: newRole } = req.body;
    if (!['customer', 'restaurant_owner', 'driver', 'admin'].includes(newRole)) {
      res.status(400).json({ success: false, message: 'Invalid role' });
      return;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { role: newRole },
      select: { id: true, phone: true, name: true, email: true, avatar: true, role: true, createdAt: true },
    });

    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update user role' });
  }
});

export default router;
