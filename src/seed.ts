import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function seed() {
  const shop = await prisma.shop.upsert({
    where: { domain: "seffy-8727.myshopify.com" },
    update: { accessToken: "test_token" },
    create: {
      domain: "seffy-8727.myshopify.com",
      accessToken: "test_token",
      scope: "read_customers,read_orders",
      plan: "free",
    },
  });

  await prisma.shopSettings.upsert({
    where: { shopId: shop.id },
    update: {},
    create: {
      shopId: shop.id,
      emailFromName: "Test Mağaza",
      emailFromAddr: "sefikkose0@gmail.com",
      resendApiKey: "re_PUAUdewq_4JtCRiwNNKk4jALfNbxXTAA4",
    },
  });

  const customers = [
    { id: "1001", email: "ahmet@test.com", first: "Ahmet", last: "Yılmaz", orders: 5, spent: 450, daysAgo: 95 },
    { id: "1002", email: "ayse@test.com", first: "Ayşe", last: "Kaya", orders: 3, spent: 280, daysAgo: 62 },
    { id: "1003", email: "mehmet@test.com", first: "Mehmet", last: "Demir", orders: 1, spent: 89, daysAgo: 35 },
    { id: "1004", email: "fatma@test.com", first: "Fatma", last: "Çelik", orders: 8, spent: 920, daysAgo: 110 },
    { id: "1005", email: "can@test.com", first: "Can", last: "Arslan", orders: 2, spent: 150, daysAgo: 45 },
    { id: "1006", email: "zeynep@test.com", first: "Zeynep", last: "Kurt", orders: 12, spent: 1800, daysAgo: 75 },
    { id: "1007", email: "emre@test.com", first: "Emre", last: "Şahin", orders: 1, spent: 55, daysAgo: 32 },
    { id: "1008", email: "selin@test.com", first: "Selin", last: "Yıldız", orders: 6, spent: 600, daysAgo: 88 },
  ];

  for (const c of customers) {
    const lastOrderDate = new Date(Date.now() - c.daysAgo * 86400000);
    let riskScore = 0;
    if (c.daysAgo > 90) riskScore = 75;
    else if (c.daysAgo > 60) riskScore = 55;
    else if (c.daysAgo > 30) riskScore = 30;
    if (c.orders === 1) riskScore += 20;
    riskScore = Math.min(riskScore, 100);
    const riskLevel = riskScore >= 70 ? "critical" : riskScore >= 50 ? "high" : riskScore >= 30 ? "medium" : "low";

    await prisma.customer.upsert({
      where: { shopId_shopifyCustomerId: { shopId: shop.id, shopifyCustomerId: c.id } },
      update: {},
      create: {
        shopId: shop.id,
        shopifyCustomerId: c.id,
        email: c.email,
        firstName: c.first,
        lastName: c.last,
        totalOrders: c.orders,
        totalSpent: c.spent,
        avgOrderValue: c.spent / c.orders,
        lastOrderDate,
        riskScore,
        riskLevel,
      },
    });
  }

  // Test kampanyası ekle
  const existingCampaign = await prisma.campaign.findFirst({ where: { shopId: shop.id } });
  if (!existingCampaign) {
    await prisma.campaign.create({
      data: {
        shopId: shop.id,
        name: "90 Gün Geri Kazanma",
        type: "winback_90",
        status: "completed",
        subject: "Sizi özledik! %15 indirim sizi bekliyor",
        bodyHtml: "<p>Merhaba, sizi çok özledik!</p>",
        discountPct: 15,
        sentCount: 4,
        openCount: 2,
        clickCount: 1,
        revenueRecovered: 180,
      },
    });
  }

  console.log("✅ Test verisi eklendi. Shop:", shop.domain);
  await prisma.$disconnect();
}

seed().catch(console.error);
