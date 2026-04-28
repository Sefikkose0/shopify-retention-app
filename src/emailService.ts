import { Resend } from "resend";
import { Customer, Campaign } from "@prisma/client";
import { prisma } from "./db";

export async function sendCampaignEmail(
  resendApiKey: string,
  fromName: string,
  fromEmail: string,
  customer: Customer,
  campaign: Campaign,
  targetId: string
): Promise<boolean> {
  const resend = new Resend(resendApiKey);

  const trackingPixel = `<img src="${process.env.HOST}/track/open/${targetId}" width="1" height="1" />`;
  const trackedHtml = campaign.bodyHtml
    .replace("[ŞİMDİ ALIŞVERİŞ YAP]", `<a href="${process.env.HOST}/track/click/${targetId}">ŞİMDİ ALIŞVERİŞ YAP</a>`)
    .replace(/href="((?!https?:\/\/)[^"]+)"/g, `href="${process.env.HOST}/track/click/${targetId}"`) +
    trackingPixel;

  try {
    await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: customer.email,
      subject: campaign.subject,
      html: trackedHtml,
    });

    await prisma.campaignTarget.update({
      where: { id: targetId },
      data: { status: "sent", sentAt: new Date() },
    });

    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { sentCount: { increment: 1 } },
    });

    return true;
  } catch (err) {
    console.error("Email send failed:", err);
    await prisma.campaignTarget.update({
      where: { id: targetId },
      data: { status: "failed" },
    });
    return false;
  }
}

export async function sendCampaignToAll(
  shopId: string,
  campaignId: string
): Promise<{ sent: number; failed: number }> {
  const [campaign, settings] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { targets: { include: { customer: true }, where: { status: "pending" } } },
    }),
    prisma.shopSettings.findUnique({ where: { shopId } }),
  ]);

  if (!campaign || !settings) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const target of campaign.targets) {
    const ok = await sendCampaignEmail(
      settings.resendApiKey,
      settings.emailFromName,
      settings.emailFromAddr,
      target.customer,
      campaign,
      target.id
    );
    if (ok) sent++;
    else failed++;
    await new Promise((r) => setTimeout(r, 100));
  }

  if (sent > 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "completed" },
    });
  }

  return { sent, failed };
}
