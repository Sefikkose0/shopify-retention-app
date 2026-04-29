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

async function shopifyFetch(shopDomain: string, accessToken: string, path: string, query: Record<string, string> = {}) {
  const params = new URLSearchParams(query).toString();
  const url = `https://${shopDomain}/admin/api/2024-01/${path}.json${params ? "?" + params : ""}`;
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
  return res.json();
}

export async function syncShopCustomers(shopDomain: string): Promise<number> {
  const shopRecord = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shopRecord) throw new Error("Shop not found");

  const { accessToken } = shopRecord;
  const lastOrderByCustomer = await getLastOrderDates(shopDomain, accessToken);

  let page = 1;
  let synced = 0;
  let hasMore = true;

  while (hasMore) {
    const data = await shopifyFetch(shopDomain, accessToken, "customers", {
      limit: "250",
      page: String(page),
    }) as { customers: ShopifyCustomer[] };

    const customers = data.customers;
    if (!customers || customers.length === 0) { hasMore = false; break; }

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

    if (customers.length < 250) hasMore = false;
    else page++;
  }

  return synced;
}

async function getLastOrderDates(shopDomain: string, accessToken: string): Promise<Record<number, Date>> {
  const map: Record<number, Date> = {};
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const data = await shopifyFetch(shopDomain, accessToken, "orders", {
      limit: "250", status: "any", page: String(page),
    }) as { orders: ShopifyOrder[] };

    const orders = data.orders || [];
    if (orders.length === 0) { hasMore = false; break; }

    for (const o of orders) {
      if (!o.customer) continue;
      const customerId = o.customer.id;
      const orderDate = new Date(o.created_at);
      if (!map[customerId] || orderDate > map[customerId]) map[customerId] = orderDate;
    }

    if (orders.length < 250) hasMore = false;
    else page++;
  }

  return map;
}
