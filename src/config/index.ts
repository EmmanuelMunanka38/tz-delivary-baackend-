import dotenv from 'dotenv';
dotenv.config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:8081').split(','),

  database: {
    url:
      process.env.DATABASE_URL ||
      'postgresql://neondb_owner:npg_pkTWY5Da3hVI@ep-flat-tooth-aqzrujfq.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require',
  },

  jwt: {
    accessSecret: (() => {
      const secret = process.env.JWT_ACCESS_SECRET;
      if (!secret || secret === 'change-me-access-secret-at-least-32-chars') {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('JWT_ACCESS_SECRET must be set in production');
        }
        return 'dev-access-secret-change-in-production';
      }
      return secret;
    })(),
    refreshSecret: (() => {
      const secret = process.env.JWT_REFRESH_SECRET;
      if (!secret || secret === 'change-me-refresh-secret-at-least-32-chars') {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('JWT_REFRESH_SECRET must be set in production');
        }
        return 'dev-refresh-secret-change-in-production';
      }
      return secret;
    })(),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    rememberExpiresIn: process.env.JWT_REMEMBER_EXPIRES_IN || '28d',
  },

  auth0: {
    domain: process.env.AUTH0_DOMAIN || '',
    clientId: process.env.AUTH0_CLIENT_ID || '',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  email: {
    mode:
      process.env.EMAIL_MODE ||
      (process.env.BREVO_API_KEY
        ? 'brevo'
        : process.env.EMAIL_RELAY_HOST && process.env.EMAIL_RELAY_USER
          ? 'self-hosted'
          : process.env.EMAIL_USER && process.env.EMAIL_PASS
            ? 'smtp'
            : 'self-hosted'),
    host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
    port: parseInt(process.env.EMAIL_PORT || '587', 10),
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    from: process.env.EMAIL_FROM || 'noreply@piki.food',
    selfHostedPort: parseInt(process.env.SELF_HOSTED_SMTP_PORT || '2525', 10),
    selfHostedDomain: process.env.SELF_HOSTED_DOMAIN || 'piki.food',
    brevoApiKey: process.env.BREVO_API_KEY || '',
    relay: {
      host: process.env.EMAIL_RELAY_HOST || '',
      port: parseInt(process.env.EMAIL_RELAY_PORT || '587', 10),
      user: process.env.EMAIL_RELAY_USER || '',
      pass: process.env.EMAIL_RELAY_PASS || '',
    },
  },

  sms: {
    username: process.env.AT_USERNAME || '',
    apiKey: process.env.AT_API_KEY || '',
    from: process.env.AT_FROM || '',
  },

  otp: {
    provider: process.env.OTP_PROVIDER || 'console',
  },

  storage: {
    provider: process.env.STORAGE_PROVIDER || 'local',
    endpoint: process.env.STORAGE_ENDPOINT || '',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    region: process.env.AWS_REGION || 'us-east-1',
    bucket: process.env.AWS_BUCKET || '',
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
    publicUrl: process.env.STORAGE_PUBLIC_URL || '',
  },

  clickPesa: {
    baseUrl: process.env.CLICKPESA_BASE_URL || 'https://api.clickpesa.com/third-parties',
    clientId: process.env.CLICKPESA_CLIENT_ID || '',
    apiKey: process.env.CLICKPESA_API_KEY || '',
    checksumKey: process.env.CLICKPESA_SECRET_KEY || '',
  },

  fcm: {
    serverKey: process.env.FCM_SERVER_KEY || '',
  },

  whatsapp: {
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v19.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'piki_whatsapp_verify_2024',
    webhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET || '',
  },

  test: {
    nodeEnv: (process.env.NODE_ENV = 'test'),
  },
} as const;

export type Config = typeof config;
export default config;
