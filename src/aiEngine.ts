import OpenAI from "openai";
import { Customer } from "@prisma/client";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface CampaignContent {
  subject: string;
  bodyHtml: string;
}

export async function generateWinbackEmail(
  customer: Customer,
  shopName: string,
  daysSinceOrder: number,
  discountPct?: number
): Promise<CampaignContent> {
  const prompt = `Sen bir e-ticaret mağazası için email pazarlama uzmanısın.
Aşağıdaki müşteri için kişiselleştirilmiş bir geri kazanma emaili yaz.

Mağaza: ${shopName}
Müşteri Adı: ${customer.firstName || "Değerli Müşteri"}
Son Siparişten Bu Yana: ${daysSinceOrder} gün
Toplam Sipariş: ${customer.totalOrders}
Toplam Harcama: $${customer.totalSpent.toFixed(2)}
${discountPct ? `İndirim: %${discountPct}` : ""}

Kurallar:
- Kısa ve samimi ol (max 3 paragraf)
- Müşteriyi özlediğimizi hissettir
- ${discountPct ? `%${discountPct} indirim kodunu vurgula` : "Özel teklif sun"}
- CTA butonu için [ŞİMDİ ALIŞVERİŞ YAP] kullan
- HTML formatında yaz
- Türkçe yaz

JSON formatında döndür:
{
  "subject": "email konusu",
  "bodyHtml": "html içerik"
}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 1024,
  });

  const text = completion.choices[0].message.content || "{}";

  try {
    return JSON.parse(text) as CampaignContent;
  } catch {
    return {
      subject: `${customer.firstName || "Sizi"} özledik!${discountPct ? ` %${discountPct} indirim sizi bekliyor` : ""}`,
      bodyHtml: `<p>Merhaba ${customer.firstName || "Değerli Müşterimiz"},</p><p>Sizi özledik! Mağazamızda yeni ürünler sizi bekliyor.</p><p><a href="#">ŞİMDİ ALIŞVERİŞ YAP</a></p>`,
    };
  }
}

export async function generateBulkSubjects(
  segment: string,
  shopName: string,
  discountPct?: number
): Promise<string[]> {
  const prompt = `${shopName} mağazası için ${segment} gündür alışveriş yapmayan müşterilere gönderilecek 5 farklı email konusu yaz.
${discountPct ? `%${discountPct} indirim var.` : ""}
Türkçe, ilgi çekici, kısa olsun.
JSON formatında döndür: {"subjects": ["konu1", "konu2", ...]}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 512,
  });

  const text = completion.choices[0].message.content || "{}";
  try {
    const parsed = JSON.parse(text);
    return parsed.subjects || [];
  } catch {
    return [];
  }
}
