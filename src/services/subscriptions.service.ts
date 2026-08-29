import axios from 'axios';
import { Decimal } from '@prisma/client/runtime/library';
import prisma from '@/db/prisma';
import config from '@/config';
import { getClickPesaToken, createPayloadChecksum } from '@/services/payment.service';
import { SubscriptionStatus } from '@prisma/client';

export interface CreatePlanInput {
  name: string;
  ClickpesaPriceId: string;
  priceCents: number;
  billingInterval: string;
  minOrderAmountCents?: number;
  freeDelivery?: boolean;
  discountPercentage?: number;
  isTrialPlan?: boolean;
  trialDays?: number;
  maxMenuItems?: number;
  hasAnalytics?: boolean;
  hasOnlinePayments?: boolean;
  priorityPlacement?: boolean;
  featuredInPopular?: boolean;
  customDesign?: boolean;
  multiBranch?: boolean;
  dedicatedManager?: boolean;
}

export interface UpdatePlanInput {
  name?: string;
  ClickpesaPriceId?: string;
  priceCents?: number;
  billingInterval?: string;
  minOrderAmountCents?: number;
  freeDelivery?: boolean;
  discountPercentage?: number;
  isTrialPlan?: boolean;
  trialDays?: number;
  maxMenuItems?: number;
  hasAnalytics?: boolean;
  hasOnlinePayments?: boolean;
  priorityPlacement?: boolean;
  featuredInPopular?: boolean;
  customDesign?: boolean;
  multiBranch?: boolean;
  dedicatedManager?: boolean;
}

export interface CreateSubscriptionInput {
  planId: string;
  phoneNumber: string;
}

function computePeriodEnd(billingInterval: string): Date {
  const now = new Date();
  if (billingInterval === 'year') {
    return new Date(now.setFullYear(now.getFullYear() + 1));
  }
  return new Date(now.setMonth(now.getMonth() + 1));
}

export async function listPlans() {
  return prisma.subscriptionPlan.findMany({
    orderBy: { createdAt: 'asc' },
  });
}

export async function getPlan(id: string) {
  return prisma.subscriptionPlan.findUnique({ where: { id } });
}

export async function createPlan(input: CreatePlanInput) {
  return prisma.subscriptionPlan.create({
    data: {
      name: input.name,
      ClickpesaPriceId: input.ClickpesaPriceId,
      priceCents: input.priceCents,
      billingInterval: input.billingInterval,
      minOrderAmountCents: input.minOrderAmountCents ?? 1500,
      freeDelivery: input.freeDelivery ?? true,
      discountPercentage: new Decimal(input.discountPercentage ?? 0),
      isTrialPlan: input.isTrialPlan ?? false,
      trialDays: input.trialDays ?? 0,
      maxMenuItems: input.maxMenuItems ?? 20,
      hasAnalytics: input.hasAnalytics ?? false,
      hasOnlinePayments: input.hasOnlinePayments ?? false,
      priorityPlacement: input.priorityPlacement ?? false,
      featuredInPopular: input.featuredInPopular ?? false,
      customDesign: input.customDesign ?? false,
      multiBranch: input.multiBranch ?? false,
      dedicatedManager: input.dedicatedManager ?? false,
    },
  });
}

export async function updatePlan(id: string, input: UpdatePlanInput) {
  return prisma.subscriptionPlan.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.ClickpesaPriceId !== undefined ? { ClickpesaPriceId: input.ClickpesaPriceId } : {}),
      ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
      ...(input.billingInterval !== undefined ? { billingInterval: input.billingInterval } : {}),
      ...(input.minOrderAmountCents !== undefined ? { minOrderAmountCents: input.minOrderAmountCents } : {}),
      ...(input.freeDelivery !== undefined ? { freeDelivery: input.freeDelivery } : {}),
      ...(input.discountPercentage !== undefined ? { discountPercentage: new Decimal(input.discountPercentage) } : {}),
      ...(input.isTrialPlan !== undefined ? { isTrialPlan: input.isTrialPlan } : {}),
      ...(input.trialDays !== undefined ? { trialDays: input.trialDays } : {}),
      ...(input.maxMenuItems !== undefined ? { maxMenuItems: input.maxMenuItems } : {}),
      ...(input.hasAnalytics !== undefined ? { hasAnalytics: input.hasAnalytics } : {}),
      ...(input.hasOnlinePayments !== undefined ? { hasOnlinePayments: input.hasOnlinePayments } : {}),
      ...(input.priorityPlacement !== undefined ? { priorityPlacement: input.priorityPlacement } : {}),
      ...(input.featuredInPopular !== undefined ? { featuredInPopular: input.featuredInPopular } : {}),
      ...(input.customDesign !== undefined ? { customDesign: input.customDesign } : {}),
      ...(input.multiBranch !== undefined ? { multiBranch: input.multiBranch } : {}),
      ...(input.dedicatedManager !== undefined ? { dedicatedManager: input.dedicatedManager } : {}),
    },
  });
}

export async function deletePlan(id: string) {
  return prisma.subscriptionPlan.delete({ where: { id } });
}

export async function getUserSubscriptions(userId: string) {
  return prisma.userSubscription.findMany({
    where: { userId },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getActiveSubscription(userId: string) {
  return prisma.userSubscription.findFirst({
    where: {
      userId,
      status: SubscriptionStatus.PAID,
      currentPeriodEnd: { gt: new Date() },
    },
    include: { plan: true },
    orderBy: { currentPeriodEnd: 'desc' },
  });
}

export async function startTrial(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }

  if (user.hasUsedFreeTrial) {
    throw new Error('Free trial already used');
  }

  const active = await getActiveSubscription(userId);
  if (active) {
    throw new Error('User already has an active subscription');
  }

  const trialPlan = await prisma.subscriptionPlan.findFirst({
    where: { isTrialPlan: true },
  });

  if (!trialPlan) {
    throw new Error('Trial plan not configured');
  }

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + trialPlan.trialDays);

  const subscription = await prisma.userSubscription.create({
    data: {
      userId,
      planId: trialPlan.id,
      stripeSubscriptionId: `TRIAL-${userId}-${Date.now()}`,
      stripeCustomerId: user.phone || user.email || '',
      status: SubscriptionStatus.PAID,
      currentPeriodEnd: trialEndsAt,
      cancelAtPeriodEnd: false,
      isTrial: true,
      trialEndsAt,
    },
    include: { plan: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { hasUsedFreeTrial: true },
  });

  return subscription;
}

export async function upgradeFromTrial(userId: string, input: CreateSubscriptionInput) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }

  const trialSubscription = await prisma.userSubscription.findFirst({
    where: {
      userId,
      isTrial: true,
      status: SubscriptionStatus.PAID,
    },
    include: { plan: true },
  });

  if (!trialSubscription) {
    throw new Error('No active trial found');
  }

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: input.planId } });
  if (!plan) {
    throw new Error('Subscription plan not found');
  }

  if (plan.isTrialPlan) {
    throw new Error('Cannot upgrade to another trial plan');
  }

  const subscriptionReference = `SUB${Date.now().toString()}${Math.floor(Math.random() * 1000)}`;
  const amount = plan.priceCents / 100;

  const token = await getClickPesaToken();

  const requestBody: Record<string, any> = {
    amount: String(amount),
    currency: 'TZS',
    orderReference: subscriptionReference,
    phoneNumber: input.phoneNumber,
    priceId: plan.ClickpesaPriceId,
    interval: plan.billingInterval,
  };
  requestBody.checksum = createPayloadChecksum(requestBody);

  const clickPesaResponse = await axios.post(`${config.clickPesa.baseUrl}/subscriptions`, requestBody, {
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
  });

  await prisma.userSubscription.update({
    where: { id: trialSubscription.id },
    data: {
      status: SubscriptionStatus.CANCELLED,
      cancelAtPeriodEnd: true,
    },
  });

  const subscription = await prisma.userSubscription.create({
    data: {
      userId,
      planId: plan.id,
      stripeSubscriptionId: subscriptionReference,
      stripeCustomerId: input.phoneNumber,
      status: SubscriptionStatus.UNPAID,
      currentPeriodEnd: computePeriodEnd(plan.billingInterval),
      cancelAtPeriodEnd: false,
      isTrial: false,
    },
    include: { plan: true },
  });

  return { subscription, clickPesa: clickPesaResponse.data };
}

export async function createSubscription(userId: string, input: CreateSubscriptionInput) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: input.planId } });
  if (!plan) {
    throw new Error('Subscription plan not found');
  }

  const active = await getActiveSubscription(userId);
  if (active) {
    throw new Error('User already has an active subscription');
  }

  const subscriptionReference = `SUB${Date.now().toString()}${Math.floor(Math.random() * 1000)}`;
  const amount = plan.priceCents / 100;

  const token = await getClickPesaToken();

  const requestBody: Record<string, any> = {
    amount: String(amount),
    currency: 'TZS',
    orderReference: subscriptionReference,
    phoneNumber: input.phoneNumber,
    priceId: plan.ClickpesaPriceId,
    interval: plan.billingInterval,
  };
  requestBody.checksum = createPayloadChecksum(requestBody);

  const clickPesaResponse = await axios.post(`${config.clickPesa.baseUrl}/subscriptions`, requestBody, {
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
  });

  const subscription = await prisma.userSubscription.create({
    data: {
      userId,
      planId: plan.id,
      stripeSubscriptionId: subscriptionReference,
      stripeCustomerId: input.phoneNumber,
      status: SubscriptionStatus.UNPAID,
      currentPeriodEnd: computePeriodEnd(plan.billingInterval),
      cancelAtPeriodEnd: false,
      isTrial: false,
    },
    include: { plan: true },
  });

  return { subscription, clickPesa: clickPesaResponse.data };
}

export async function cancelSubscription(userId: string, subscriptionId: string) {
  const subscription = await prisma.userSubscription.findUnique({ where: { id: subscriptionId } });
  if (!subscription) {
    throw new Error('Subscription not found');
  }
  if (subscription.userId !== userId) {
    throw new Error('Not authorized to cancel this subscription');
  }

  await axios
    .post(
      `${config.clickPesa.baseUrl}/subscriptions/${subscription.stripeSubscriptionId}/cancel`,
      {},
      {
        headers: {
          Authorization: await getClickPesaToken(),
          'Content-Type': 'application/json',
        },
      },
    )
    .catch(() => undefined);

  return prisma.userSubscription.update({
    where: { id: subscriptionId },
    data: { cancelAtPeriodEnd: true, status: SubscriptionStatus.CANCELLED },
  });
}

export async function handleClickPesaWebhook(event: string, data: any) {
  const reference = data?.orderReference;
  if (!reference) {
    return { skipped: true };
  }

  const subscription = await prisma.userSubscription.findUnique({
    where: { stripeSubscriptionId: reference },
  });
  if (!subscription) {
    return { skipped: true };
  }

  if (event === 'PAYMENT RECEIVED' && data.status === 'SUCCESS') {
    await prisma.userSubscription.update({
      where: { id: subscription.id },
      data: { status: SubscriptionStatus.PAID },
    });
  } else if (event === 'PAYMENT FAILED') {
    await prisma.userSubscription.update({
      where: { id: subscription.id },
      data: { status: SubscriptionStatus.UNPAID },
    });
  }

  return { processed: true };
}

export async function checkPlanLimit(userId: string, feature: string) {
  const subscription = await getActiveSubscription(userId);

  if (!subscription) {
    return { allowed: false, message: 'No active subscription' };
  }

  const plan = subscription.plan;

  if (feature === 'menuItems') {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { ownedRestaurants: true },
    });

    if (!user || user.ownedRestaurants.length === 0) {
      return { allowed: true, limit: plan.maxMenuItems, current: 0 };
    }

    const restaurantIds = user.ownedRestaurants.map((r) => r.id);
    const menuItemCount = await prisma.menuItem.count({
      where: { restaurantId: { in: restaurantIds } },
    });

    const allowed = menuItemCount < plan.maxMenuItems;
    return {
      allowed,
      limit: plan.maxMenuItems,
      current: menuItemCount,
      message: allowed ? undefined : 'Menu item limit reached',
    };
  }

  if (feature === 'analytics') {
    return { allowed: plan.hasAnalytics };
  }

  if (feature === 'onlinePayments') {
    return { allowed: plan.hasOnlinePayments };
  }

  if (feature === 'priorityPlacement') {
    return { allowed: plan.priorityPlacement };
  }

  if (feature === 'featuredInPopular') {
    return { allowed: plan.featuredInPopular };
  }

  if (feature === 'customDesign') {
    return { allowed: plan.customDesign };
  }

  if (feature === 'multiBranch') {
    return { allowed: plan.multiBranch };
  }

  if (feature === 'dedicatedManager') {
    return { allowed: plan.dedicatedManager };
  }

  return { allowed: false, message: 'Unknown feature' };
}
