import { Router, Request, Response } from 'express';
import config from '@/config';
import { processWebhook, verifyWebhookSignature } from '@/services/whatsapp/whatsapp-webhook.service';

const router = Router();

router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  //these use whats app webhooks for this

  if (mode === 'subscribe' && token === config.whatsapp.webhookVerifyToken) {
    console.log('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    console.error('WhatsApp webhook verification failed');
    res.status(403).json({ success: false, message: 'Verification failed' });
  }
});

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    if (config.whatsapp.webhookSecret) {
      const signature = req.headers['x-hub-signature-256'] as string;
      if (!signature) {
        console.error('Missing webhook signature');
        res.status(401).json({ success: false, message: 'Missing signature' });
        return;
      }

      const payload = JSON.stringify(req.body);
      if (!verifyWebhookSignature(payload, signature)) {
        console.error('Invalid webhook signature');
        res.status(401).json({ success: false, message: 'Invalid signature' });
        return;
      }
    }

    await processWebhook(req.body);

    res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    res.status(200).json({ success: true, message: 'Webhook acknowledged' });
  }
});

export default router;
