import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding subscription plans...');

  await prisma.subscriptionPlan.upsert({
    where: { ClickpesaPriceId: 'free-trial' },
    update: {},
    create: {
      name: 'Free Trial',
      ClickpesaPriceId: 'free-trial',
      priceCents: 0,
      billingInterval: 'month',
      isTrialPlan: true,
      trialDays: 14,
      maxMenuItems: 20,
      hasAnalytics: false,
      hasOnlinePayments: false,
      priorityPlacement: false,
      featuredInPopular: false,
      customDesign: false,
      multiBranch: false,
      dedicatedManager: false,
    },
  });

  await prisma.subscriptionPlan.upsert({
    where: { ClickpesaPriceId: 'growth-monthly' },
    update: {},
    create: {
      name: 'Growth',
      ClickpesaPriceId: 'growth-monthly',
      priceCents: 5000000,
      billingInterval: 'month',
      maxMenuItems: 999999,
      hasAnalytics: true,
      hasOnlinePayments: true,
      priorityPlacement: true,
      featuredInPopular: true,
      customDesign: false,
      multiBranch: false,
      dedicatedManager: false,
    },
  });

  await prisma.subscriptionPlan.upsert({
    where: { ClickpesaPriceId: 'pro-monthly' },
    update: {},
    create: {
      name: 'Pro',
      ClickpesaPriceId: 'pro-monthly',
      priceCents: 9000000,
      billingInterval: 'month',
      maxMenuItems: 999999,
      hasAnalytics: true,
      hasOnlinePayments: true,
      priorityPlacement: true,
      featuredInPopular: true,
      customDesign: true,
      multiBranch: true,
      dedicatedManager: true,
    },
  });

  console.log('Subscription plans seeded successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
