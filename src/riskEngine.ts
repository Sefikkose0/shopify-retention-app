import { Customer } from "@prisma/client";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskResult {
  score: number;
  level: RiskLevel;
  reasons: string[];
  daysSinceLastOrder: number | null;
}

export function calculateRisk(customer: Customer): RiskResult {
  let score = 0;
  const reasons: string[] = [];

  const now = new Date();
  let daysSinceLastOrder: number | null = null;

  if (customer.lastOrderDate) {
    daysSinceLastOrder = Math.floor(
      (now.getTime() - new Date(customer.lastOrderDate).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceLastOrder > 90) {
      score += 40;
      reasons.push(`${daysSinceLastOrder} gündür sipariş yok`);
    } else if (daysSinceLastOrder > 60) {
      score += 30;
      reasons.push(`60+ gündür sipariş yok`);
    } else if (daysSinceLastOrder > 30) {
      score += 20;
      reasons.push(`30+ gündür sipariş yok`);
    }
  } else {
    score += 10;
    reasons.push("Sipariş geçmişi yok");
  }

  if (customer.totalOrders === 1) {
    score += 25;
    reasons.push("Tek sipariş veren müşteri");
  } else if (customer.totalOrders <= 3) {
    score += 10;
    reasons.push("Az sipariş sayısı");
  }

  if (customer.avgOrderValue > 0 && customer.totalSpent > 0) {
    const expectedSpend = customer.avgOrderValue * customer.totalOrders;
    if (customer.totalSpent < expectedSpend * 0.7) {
      score += 15;
      reasons.push("Düşen sipariş değeri trendi");
    }
  }

  if (customer.totalSpent > 500) {
    score += 10;
    reasons.push("Yüksek değerli müşteri kaybı riski");
  }

  score = Math.min(score, 100);

  let level: RiskLevel;
  if (score >= 70) level = "critical";
  else if (score >= 50) level = "high";
  else if (score >= 30) level = "medium";
  else level = "low";

  return { score, level, reasons, daysSinceLastOrder };
}

export function filterByWinbackSegment(
  customers: Customer[],
  segment: "30" | "60" | "90"
): Customer[] {
  const thresholds = { "30": [30, 60], "60": [60, 90], "90": [90, 9999] };
  const [min, max] = thresholds[segment];
  const now = new Date();

  return customers.filter((c) => {
    if (!c.lastOrderDate) return false;
    const days = Math.floor(
      (now.getTime() - new Date(c.lastOrderDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    return days >= min && days < max;
  });
}
