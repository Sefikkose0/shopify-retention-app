import { prisma } from "./db";
import { calculateRisk } from "./riskEngine";

interface ShopifyCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  orders_count: number;
  total_spent: string;
  created_at: string;
  tags: string;
}

interface ShopifyOrder {
  id: number;
  created_at: string;
  total_price: string;
  customer: { id: number } | null;
}

function parseLinkHeader(link: string | null): { next?: string } {
  if (!link) return {};
  const result: { next?: string } = {};
  for (const part of link.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="(\w+)"/);
    if (match) result[match[2] as "next"] = match[1];
  }
  return result;
}

async function shopifyFetchWithHeaders(shopDomain: string, accessToken: string, url: string) {
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify API error ${res.status}: ${body}`);
  }
  const data = await res.json();
  const link = res.headers.get("Link");
  return { data, link };
}

export async function syncShopCustomers(shopDomain: string): Promise<number> {
  const shopRecord = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shopRecord) throw new Error("Shop not found");

  const { accessToken } = shopRecord;
  let lastOrderByCustomer: Record<number, Date> = {};
  try {
    lastOrderByCustomer = await getLastOrderDates(shopDomain, accessToken);
  } catch {
    // read_orders scope yoksa atla, lastOrderDate null kalır
  }

  let synced = 0;
  let nextUrl: string | undefined = `https://${shopDomain}/admin/api/2024-01/customers.json?limit=250`;

  while (nextUrl) {
    const { data, link } = await shopifyFetchWithHeaders(shopDomain, accessToken, nextUrl);
    const customers: ShopifyCustomer[] = (data as any).customers || [];
    if (customers.length === 0) break;

    for (const c of customers) {
      if (!c.email) continue;

      const totalOrders = c.orders_count || 0;
      const totalSpent = parseFloat(c.total_spent || "0");
      const avgOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;
      const lastOrderDate = lastOrderByCustomer[c.id] || null;
      const firstOrderDate = c.created_at ? new Date(c.created_at) : null;

      const tempCustomer = {
        id: "", shopId: shopRecord.id,
        shopifyCustomerId: String(c.id),
        email: c.email,
        firstName: c.first_name || "",
        lastName: c.last_name || "",
        totalOrders, totalSpent, avgOrderValue,
        lastOrderDate, firstOrderDate,
        riskScore: 0, riskLevel: "low",
        tags: c.tags || "",
        syncedAt: new Date(), updatedAt: new Date(),
      };

      const risk = calculateRisk(tempCustomer as any);

      await prisma.customer.upsert({
        where: { shopId_shopifyCustomerId: { shopId: shopRecord.id, shopifyCustomerId: String(c.id) } },
        update: {
          email: c.email, firstName: c.first_name || "", lastName: c.last_name || "",
          totalOrders, totalSpent, avgOrderValue, lastOrderDate,
          riskScore: risk.score, riskLevel: risk.level, tags: c.tags || "", syncedAt: new Date(),
        },
        create: {
          shopId: shopRecord.id, shopifyCustomerId: String(c.id),
          email: c.email, firstName: c.first_name || "", lastName: c.last_name || "",
          totalOrders, totalSpent, avgOrderValue, lastOrderDate, firstOrderDate,
          riskScore: risk.score, riskLevel: risk.level, tags: c.tags || "",
        },
      });
      synced++;
    }

    nextUrl = parseLinkHeader(link).next;
  }

  return synced;
}

async function getLastOrderDates(shopDomain: string, accessToken: string): Promise<Record<number, Date>> {
  const map: Record<number, Date> = {};
  let nextUrl: string | undefined = `https://${shopDomain}/admin/api/2024-01/orders.json?limit=250&status=any`;

  while (nextUrl) {
    const { data, link } = await shopifyFetchWithHeaders(shopDomain, accessToken, nextUrl);
    const orders: ShopifyOrder[] = (data as any).orders || [];
    if (orders.length === 0) break;

    for (const o of orders) {
      if (!o.customer) continue;
      const customerId = o.customer.id;
      const orderDate = new Date(o.created_at);
      if (!map[customerId] || orderDate > map[customerId]) map[customerId] = orderDate;
    }

    nextUrl = parseLinkHeader(link).next;
  }

  return map;
}
