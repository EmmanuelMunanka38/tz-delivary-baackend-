import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import config from '../config';
import prisma from '../db/prisma';

let io: Server;

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: string;
}

export const initializeSocket = (httpServer: HttpServer): Server => {
  io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigin,
      credentials: true,
    },
    pingInterval: 10000,
    pingTimeout: 5000,
  });

  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token as string, config.jwt.accessSecret) as any;
      const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = user.id;
      socket.userRole = user.role;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`[WS] User ${socket.userId} connected (${socket.userRole})`);

    // Join user-specific room
    socket.join(`user:${socket.userId}`);

    // Join role-based room
    if (socket.userRole) {
      socket.join(`role:${socket.userRole}`);
    }

    // Customer joins order tracking
    socket.on('track:order', (orderId: string) => {
      socket.join(`order:${orderId}`); 
      console.log(`[WS] User ${socket.userId} tracking order ${orderId}`);
    });

    socket.on('leave:order', (orderId: string) => {
      socket.leave(`order:${orderId}`);
    });

    // Driver location updates
    socket.on('location:update', (data: { latitude: number; longitude: number; orderId?: string }) => {
      // Broadcast to relevant order trackers
      if (data.orderId) {
        io.to(`order:${data.orderId}`).emit('driver:location', {
          driverId: socket.userId,
          latitude: data.latitude,
          longitude: data.longitude,
          timestamp: new Date().toISOString(),
        });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[WS] User ${socket.userId} disconnected`);
    });
  });

  return io;
};

export const getIO = (): Server => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};

export const emitOrderUpdate = (orderId: string, event: string, data: any): void => {
  if (io) {
    io.to(`order:${orderId}`).emit(event, data);
    // Also emit to the general orders room for restaurant/driver dashboards
    io.emit(`order:${orderId}:${event}`, data);
  }
};

export const emitToUser = (userId: string, event: string, data: any): void => {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
  }
};

export const emitToRole = (role: string, event: string, data: any): void => {
  if (io) {
    io.to(`role:${role}`).emit(event, data);
  }
};
