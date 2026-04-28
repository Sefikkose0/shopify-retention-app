import "@shopify/shopify-api/adapters/node";
import { shopifyApi, ApiVersion, Session } from "@shopify/shopify-api";
import { prisma } from "./db";

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  scopes: (process.env.SHOPIFY_SCOPES || "read_customers,read_orders").split(","),
  hostName: (process.env.HOST || "").replace(/https?:\/\//, ""),
  hostScheme: "https",
  apiVersion: ApiVersion.January25,
  isEmbeddedApp: true,
});

export async function getShopSession(shop: string): Promise<Session | null> {
  const record = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!record) return null;

  const session = new Session({
    id: `offline_${shop}`,
    shop,
    state: "active",
    isOnline: false,
    accessToken: record.accessToken,
    scope: record.scope,
  });
  return session;
}

export async function getShopifyClient(shop: string) {
  const session = await getShopSession(shop);
  if (!session) throw new Error(`No session for shop: ${shop}`);
  return new shopify.clients.Rest({ session });
}
