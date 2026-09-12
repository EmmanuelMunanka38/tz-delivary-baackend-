import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';

import config from './config';
import { globalLimiter, publicLimiter, openEndpointLimiter } from './middleware/rateLimiter';
import errorHandler from './middleware/errorHandler';

// Route Imports
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

// Trust proxies across multi-hop setup (Cloudflare -> pikifood-proxy -> Render LB)
app.set('trust proxy', true);

// Security & Standard Middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: (origin, callback) => {
      if (config.isDev || !origin) return callback(null, true);
      if (config.corsOrigin.indexOf(origin) !== -1) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(compression());

if (config.isDev) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files for uploads (Bypasses rate limiters)
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));


// 1. UNTHROTTLED OPERATIONAL & WEBHOOK ROUTES (Must be BEFORE rate limiters)


// Webhooks
app.use('/api/payments', clickPesaWebhookRouter);
app.use('/api/subscriptions/webhook', clickPesaSubscriptionWebhookRouter);

// Health & Monitoring
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

app.get('/api/debug/ip', (req, res) => {
  res.json({
    ip: req.ip,
    remoteAddress: req.socket.remoteAddress,
    forwardedFor: req.headers['x-forwarded-for'] || 'not set',
    trustProxy: app.get('trust proxy'),
  });
});


// 2. RATE LIMITERS (Applied only to business API endpoints)


app.use(globalLimiter);
app.use('/api/', publicLimiter);


// 3. PROTECTED API ROUTES


app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/restaurants', openEndpointLimiter, restaurantRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/categories', openEndpointLimiter, categoryRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/restaurant-owner', restaurantOwnerRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/promotions', openEndpointLimiter, promotionRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/whatsapp/flow', whatsappFlowRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler
app.use(errorHandler);

export default app;