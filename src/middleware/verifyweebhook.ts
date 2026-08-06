import { Request, Response, NextFunction } from 'express';
import { validateWebhookChecksum } from '@/services/payment.service';

export default function verifyClickPesaWebhook(req: Request, res: Response, next: NextFunction): void {
  const { checksum } = req.body;

  if (!checksum) {
    res.status(401).json({ success: false, message: 'Missing webhook checksum' });
    return;
  }

  const isValid = validateWebhookChecksum(req.body, checksum);

  if (!isValid) {
    res.status(401).json({ success: false, message: 'Invalid webhook checksum' });
    return;
  }

  next();
}
