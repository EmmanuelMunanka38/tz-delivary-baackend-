import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import auth, { AuthRequest } from '../middleware/auth';
import { storage } from '../services/storage.service';

const router = Router();

const ALLOWED_TYPES = ['profile', 'restaurant', 'menu', 'promotion'] as const;
const MAX_SIZE = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    if (allowedMime.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WebP, and AVIF images are allowed'));
    }
  },
});

router.post(
  '/',
  auth,
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ]),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const imageType = (req.body.type || 'menu') as (typeof ALLOWED_TYPES)[number];

      if (!ALLOWED_TYPES.includes(imageType)) {
        res
          .status(400)
          .json({ success: false, message: 'Invalid upload type. Use: profile, restaurant, menu, or promotion' });
        return;
      }

      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const file = files?.image?.[0] || files?.file?.[0];
      if (!file) {
        res.status(400).json({ success: false, message: 'No image file provided' });
        return;
      }

      const ext = path.extname(file.originalname) || '.jpg';
      const key = `${imageType}s/${uuidv4()}${ext}`;

      const url = await storage.upload(key, file.buffer, file.mimetype);

      res.json({ success: true, data: { url, key } });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ success: false, message: 'Failed to upload image' });
    }
  },
);

export default router;
