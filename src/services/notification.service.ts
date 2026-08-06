import axios from 'axios';
import prisma from '../db/prisma';
import config from '../config';

export interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
  data?: any;
}

export const sendPushNotification = async (userId: string, title: string, body: string, data?: Record<string, unknown>): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fcmToken: true },
  });

  if (user?.fcmToken && config.fcm.serverKey) {
    try {
      await axios.post(
        'https://fcm.googleapis.com/fcm/send',
        {
          to: user.fcmToken,
          notification: { title, body },
          data: data || {},
          android: { priority: 'high' },
        },
        {
          headers: {
            Authorization: `key=${config.fcm.serverKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        },
      );
    } catch (error: any) {
      console.error(`[FCM] Failed to send push to ${userId}:`, error?.response?.data || error?.message);
    }
  }

  await createNotification({ userId, title, body, data });
};

export const createNotification = async (payload: NotificationPayload): Promise<void> => {
  await prisma.notification.create({
    data: {
      userId: payload.userId,
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
    },
  });
};

export const getNotifications = async (userId: string, limit = 20, offset = 0) => {
  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.notification.count({ where: { userId } }),
  ]);

  return { notifications, total, limit, offset };
};

export const markNotificationRead = async (notificationId: string, userId: string): Promise<void> => {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { read: true },
  });
};

export const markAllNotificationsRead = async (userId: string): Promise<void> => {
  await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
};
