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
}

export interface UpdatePlanInput {
  name?: string;
  ClickpesaPriceId?: string;
  priceCents?: number;
  billingInterval?: string;
  minOrderAmountCents?: number;
  freeDelivery?: boolean;
  discountPercentage?: number;
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
