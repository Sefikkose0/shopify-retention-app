import { Router, Request, Response } from "express";
import { shopify } from "../shopify";
import { prisma } from "../db";

const router = Router();

router.get("/auth", async (req: Request, res: Response) => {
  const shop = req.query.shop as string;
  if (!shop) return res.status(400).send("Missing shop parameter");

  await shopify.auth.begin({
    shop,
    callbackPath: "/auth/callback",
    isOnline: false,
    rawRequest: req,
    rawResponse: res,
  });
});

router.get("/auth/callback", async (req: Request, res: Response) => {
  try {
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    const { session } = callback;

    await prisma.shop.upsert({
      where: { domain: session.shop },
      update: {
        accessToken: session.accessToken!,
        scope: session.scope!,
        isActive: true,
      },
      create: {
        domain: session.shop,
        accessToken: session.accessToken!,
        scope: session.scope!,
      },
    });

    const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
    if (shop) {
      await prisma.shopSettings.upsert({
        where: { shopId: shop.id },
        update: {},
        create: { shopId: shop.id },
      });
    }

    const host = req.query.host as string;
    res.redirect(`/?shop=${session.shop}&host=${host}`);
  } catch (err) {
    console.error("Auth callback error:", err);
    res.status(500).send("Authentication failed");
  }
});

export default router;
