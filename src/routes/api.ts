// v2 - cursor pagination
import { Router, Request, Response } from "express";
import { prisma } from "../db";
import { syncShopCustomers } from "../syncCustomers";
import { generateWinbackEmail, generateBulkSubjects } from "../aiEngine";
import { sendCampaignToAll } from "../emailService";
import { filterByWinbackSegment } from "../riskEngine";

const router = Router();

function requireShop(req: Request, res: Response): string | null {
  const shop = req.query.shop as string || req.body?.shop;
  if (!shop) { res.status(401).json({ error: "Missing shop" }); return null; }
  return shop;
}

// --- Setup Token (Custom App bypass) ---
router.get("/api/setup-token", async (req, res) => {
  const { shop, token } = req.query as Record<string, string>;
  if (!shop || !token) return res.status(400).json({ error: "shop ve token gerekli" });

  await prisma.shop.upsert({
    where: { domain: shop },
    update: { accessToken: token, isActive: true },
    create: { domain: shop, accessToken: token, scope: "read_customers,read_orders", isActive: true },
  });

  const shopRecord = await prisma.shop.findUnique({ where: { domain: shop } });
  if (shopRecord) {
    await prisma.shopSettings.upsert({
      where: { shopId: shopRecord.id },
      update: {},
      create: { shopId: shopRecord.id },
    });
  }

  res.json({ success: true, message: `Token kaydedildi: ${shop}` });
});

// --- Dashboard Stats ---
router.get("/api/dashboard", async (req, res) => {
  const shop = requireShop(req, res);
  if (!shop) return;

  const shopRecord = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) return res.status(404).json({ error: "Shop not found" });

  const [totalCustomers, atRisk, critical, campaigns] = await Promise.all([
    prisma.customer.count({ where: { shopId: shopRecord.id } }),
    prisma.customer.count({ where: { shopId: shopRecord.id, riskLevel: { in: ["high", "critical"] } } }),
    prisma.customer.count({ where: { shopId: shopRecord.id, riskLevel: "critical" } }),
    prisma.campaign.findMany({
      where: { shopId: shopRecord.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const revenueRecovered = campaigns.reduce((sum, c) => sum + c.revenueRecovered, 0);

  res.json({ totalCustomers, atRisk, critical, revenueRecovered, recentCampaigns: campaigns });
});

// --- Customer List ---
router.get("/api/customers", async (req, res) => {
  const shop = requireShop(req, res);
  if (!shop) return;

  const shopRecord = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) return res.status(404).json({ error: "Shop not found" });

  const { riskLevel, segment, page = "1", limit = "50" } = req.query as Record<string, string>;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where: any = { shopId: shopRecord.id };
  if (riskLevel) where.riskLevel = riskLevel;

  let customers = await prisma.customer.findMany({
    where,
    orderBy: { riskScore: "desc" },
    skip,
    take: parseInt(limit),
  });

  if (segment) {
    customers = filterByWinbackSegment(customers, segment as "30" | "60" | "90");
  }

  const total = await prisma.customer.count({ where });
  res.json({ customers, total, page: parseInt(page), limit: parseInt(limit) });
});

// --- Sync Customers ---
router.post("/api/sync", async (req, res) => {
  const shop = requireShop(req, res);
  if (!shop) return;

  const shopRecord = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) return res.status(404).json({ error: "Mağaza bulunamadı" });
  if (shopRecord.accessToken === "test_token") {
    return res.json({ success: true, synced: 0, message: "Test modunda gerçek senkronizasyon yapılmaz. Uygulamayı Shopify mağazanıza kurunca çalışacak." });
  }

  try {
    const count = await syncShopCustomers(shop);
    res.json({ success: true, synced: count });
  } catch (err: any) {
    res.status(500).json({ error: "Shopify bağlantı hatası: " + err.message });
  }
});

// --- Campaigns ---
router.get("/api/campaigns", async (req, res) => {
  const shop = requireShop(req, res);
  if (!shop) return;

  const shopRecord = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) return res.status(404).json({ error: "Shop not found" });

  const campaigns = await prisma.campaign.findMany({
    where: { shopId: shopRecord.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { targets: true } } },
  });

  res.json({ campaigns });
});

router.post("/api/campaigns", async (req, res) => {
  const shop = requireShop(req, res);
  if (!shop) return;

  const shopRecord = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) return res.status(404).json({ error: "Shop not found" });

  const { name, type, segment, discountPct, useAI } = req.body;

  let subject = req.body.subject || "";
  let bodyHtml = req.body.bodyHtml || "";

  if (useAI) {
    const shopData = await prisma.shop.findUnique({ where: { domain: shop } });
    const subjects = await generateBulkSubjects(segment || type, shopData?.domain || shop, discountPct);
    subject = subjects[0] || subject;
  }

  const targetCustomers = await prisma.customer.findMany({
    where: { shopId: shopRecord.id },
  });

  const segmentCustomers = type.includes("winback")
    ? filterByWinbackSegment(targetCustomers, (type.split("_")[1] || "30") as "30" | "60" | "90")
    : targetCustomers.filter((c) => c.riskLevel === "high" || c.riskLevel === "critical");

  if (useAI && segmentCustomers.length > 0) {
    const first = segmentCustomers[0];
    const days = first.lastOrderDate
      ? Math.floor((Date.now() - new Date(first.lastOrderDate).getTime()) / 86400000)
      : 30;
    const content = await generateWinbackEmail(first, shop, days, discountPct);
    subject = content.subject;
    bodyHtml = content.bodyHtml;
  }

  const campaign = await prisma.campaign.create({
    data: {
      shopId: shopRecord.id,
      name,
      type,
      subject,
      bodyHtml,
      discountPct: discountPct ? parseInt(discountPct) : null,
      status: "draft",
      targets: {
        create: segmentCustomers.map((c) => ({ customerId: c.id })),
      },
    },
  });

  res.json({ campaign, targetCount: segmentCustomers.length });
});

router.post("/api/campaigns/:id/send", async (req, res) => {
  const shop = requireShop(req, res);
  if (!shop) return;

  const shopRecord = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) return res.status(404).json({ error: "Shop not found" });

  const settings = await prisma.shopSettings.findUnique({ where: { shopId: shopRecord.id } });
  if (!settings?.resendApiKey) {
    return res.status(400).json({ error: "Resend API key not configured in settings" });
  }

  const { sent, failed } = await sendCampaignToAll(shopRecord.id, req.params.id);
  res.json({ success: true, sent, failed });
});

// --- Settings ---
router.get("/api/settings", async (req, res) => {
  const shop = requireShop(req, res);
  if (!shop) return;

  const shopRecord = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) return res.status(404).json({ error: "Shop not found" });

  const settings = await prisma.shopSettings.findUnique({ where: { shopId: shopRecord.id } });
  res.json({ settings });
});

router.put("/api/settings", async (req, res) => {
  const shop = requireShop(req, res);
  if (!shop) return;

  const shopRecord = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) return res.status(404).json({ error: "Shop not found" });

  const { emailFromName, emailFromAddr, resendApiKey, winbackDays30, winbackDays60, winbackDays90, aiEnabled } = req.body;
  const data: any = {};
  if (emailFromName !== undefined) data.emailFromName = emailFromName;
  if (emailFromAddr !== undefined) data.emailFromAddr = emailFromAddr;
  if (resendApiKey !== undefined && resendApiKey !== "••••••••") data.resendApiKey = resendApiKey;
  if (winbackDays30 !== undefined) data.winbackDays30 = winbackDays30;
  if (winbackDays60 !== undefined) data.winbackDays60 = winbackDays60;
  if (winbackDays90 !== undefined) data.winbackDays90 = winbackDays90;
  if (aiEnabled !== undefined) data.aiEnabled = aiEnabled;

  const settings = await prisma.shopSettings.upsert({
    where: { shopId: shopRecord.id },
    update: data,
    create: { shopId: shopRecord.id, ...data },
  });

  res.json({ settings });
});

// --- Tracking ---
router.get("/track/open/:targetId", async (req, res) => {
  await prisma.campaignTarget.updateMany({
    where: { id: req.params.targetId, openedAt: null },
    data: { status: "opened", openedAt: new Date() },
  });
  const target = await prisma.campaignTarget.findUnique({ where: { id: req.params.targetId } });
  if (target) {
    await prisma.campaign.update({
      where: { id: target.campaignId },
      data: { openCount: { increment: 1 } },
    });
  }
  // 1x1 transparent gif
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  res.set("Content-Type", "image/gif").send(gif);
});

router.get("/track/click/:targetId", async (req, res) => {
  const target = await prisma.campaignTarget.findUnique({
    where: { id: req.params.targetId },
    include: { campaign: true },
  });
  if (target && !target.clickedAt) {
    await prisma.campaignTarget.update({
      where: { id: req.params.targetId },
      data: { status: "clicked", clickedAt: new Date() },
    });
    await prisma.campaign.update({
      where: { id: target.campaignId },
      data: { clickCount: { increment: 1 } },
    });
  }
  res.redirect("https://" + (req.query.shop || ""));
});

// --- Billing ---
router.get("/api/billing/subscribe", async (req, res) => {
  const shop = requireShop(req, res);
  if (!shop) return;

  const shopRecord = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) {
    return res.status(404).json({ error: "Mağaza bulunamadı. Önce uygulamayı mağazanıza kurun." });
  }

  const plan = (req.query.plan as string) || "starter";
  const prices: Record<string, number> = { starter: 29, growth: 59, pro: 99 };
  const price = prices[plan] || 29;
  const planName = plan.charAt(0).toUpperCase() + plan.slice(1);

  try {
    const response = await fetch(`https://${shop}/admin/api/2024-01/recurring_application_charges.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": shopRecord.accessToken,
      },
      body: JSON.stringify({
        recurring_application_charge: {
          name: `Retention Engine - ${planName}`,
          price,
          return_url: `${process.env.HOST}/api/billing/callback?shop=${shop}&plan=${plan}`,
          test: true,
          trial_days: 7,
        },
      }),
    });

    const data = await response.json() as any;
    const confirmUrl = data?.recurring_application_charge?.confirmation_url;

    if (confirmUrl) {
      res.redirect(confirmUrl);
    } else {
      const errMsg = data?.errors ? JSON.stringify(data.errors) : "Abonelik başlatılamadı";
      res.status(500).json({ error: errMsg });
    }
  } catch (err: any) {
    res.status(500).json({ error: "Bağlantı hatası: " + err.message });
  }
});

router.get("/api/billing/callback", async (req, res) => {
  const { shop, charge_id, plan } = req.query as Record<string, string>;
  if (!shop || !charge_id) return res.status(400).send("Invalid billing callback");

  await prisma.shop.update({
    where: { domain: shop },
    data: { plan: plan || "starter", billingId: charge_id },
  });

  res.redirect(`/?shop=${shop}&billing=success`);
});

export default router;
