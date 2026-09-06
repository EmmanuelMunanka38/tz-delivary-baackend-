import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';

import config from './config';
import { generalLimiter } from './middleware/rateLimiter';
import errorHandler from './middleware/errorHandler';
// routes ie api_endpoints
import authRoutes from './routes/auth';
import restaurantRoutes from './routes/restaurants';
import orderRoutes from './routes/orders';
import categoryRoutes from './routes/categories';
import cartRoutes from './routes/cart';
import driverRoutes from './routes/driver';
import restaurantOwnerRoutes from './routes/restaurantOwner';
import userRoutes from './routes/users';
import uploadRoutes from './routes/upload';
import promotionRoutes from './routes/promotions';
import paymentRoutes, { clickPesaWebhookRouter } from './routes/payment';
import subscriptionRoutes, { clickPesaSubscriptionWebhookRouter } from './routes/subscriptions';
import contactRoutes from './routes/contact';
import whatsappRoutes from './routes/whatsapp';
import whatsappFlowRoutes from './routes/whatsapp-flow';

const app = express();

// Security
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: (origin, callback) => {
      // 1. In development, allow requests with no origin (like mobile apps, emulators, or Postman)
      // 2. Or automatically allow any origin on your local development machine
      if (config.isDev || !origin) {
        return callback(null, true);
      }

      // 3. In production, strictly match against your .env CORS_ORIGIN array
      if (config.corsOrigin.indexOf(origin) !== -1) {
        return callback(null, true);
      } else {
        return callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
// Performance
app.use(compression());

// Logging
if (config.isDev) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ClickPesa webhook (must be before rate limiter)
app.use('/api/payments', clickPesaWebhookRouter);
app.use('/api/subscriptions/webhook', clickPesaSubscriptionWebhookRouter);

// Rate limiting
app.use('/api/', generalLimiter);

// Static files for uploads
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Health check
app.all('/', (_req, res) => {
  res.json({ success: true, message: 'Piki Food API is running' });
});

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    message: 'Piki Food API is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Metrics endpoint (basic)
app.get('/api/metrics', (_req, res) => {
  res.json({
    success: true,
    data: {
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      nodeVersion: process.version,
      environment: config.nodeEnv,
    },
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/restaurant-owner', restaurantOwnerRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/promotions', promotionRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/whatsapp/flow', whatsappFlowRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Error handler
app.use(errorHandler);

export default app;
