import 'module-alias/register';
import http from 'http';
import app from './app';
import config from './config';
import prisma from './db/prisma';
import { initializeSocket } from './socket';

const server = http.createServer(app);

// Initialize Socket.IO
initializeSocket(server);

// Verify DB connection and start server
const start = async () => {
  try {
    await prisma.$connect();
    console.log('PostgreSQL connected');

    server.listen(config.port, () => {
      console.log(`Piki Food API running on port ${config.port} (${config.nodeEnv})`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    await prisma.$disconnect();
    console.log('Server closed');
    process.exit(0);
  });

  // Force exit after 10s
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (typeof require !== 'undefined' && require.main === module) {
  start().catch((error) => {
    console.error('Startup error:', error);
    process.exit(1);
  });
}

export { app, server };
