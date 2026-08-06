import { Router, Request, Response } from 'express';
import { sendContactEmail } from '../services/email.service';

const router = Router();

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, subject, message } = req.body || {};

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const trimmedEmail = typeof email === 'string' ? email.trim() : '';
    const trimmedSubject = typeof subject === 'string' ? subject.trim() : '';
    const trimmedMessage = typeof message === 'string' ? message.trim() : '';

    if (!trimmedName || !trimmedEmail || !trimmedMessage) {
      res.status(400).json({
        success: false,
        message: 'Name, email and message are required.',
      });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
      return;
    }

    await sendContactEmail({
      name: trimmedName,
      email: trimmedEmail,
      subject: trimmedSubject || 'Message from the website',
      message: trimmedMessage,
    });

    res.json({ success: true, message: 'Message sent successfully. We will get back to you soon.' });
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ success: false, message: 'Failed to send message. Please try again later.' });
  }
});

export default router;
