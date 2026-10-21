// The Finance Officer's invoices: each member's statement, by email.
//
// GET  /api/finances/invoices?scope=YYYY-MM|all  — finance:manage. Who would
//      get one, for how much, who can't (and why), and when each last went.
// POST /api/finances/invoices  { scope, memberIds? }  — finance:manage.
//      Sends to everyone sendable, or only the members named. One batch to
//      the mail service, one InvoiceSend row per invoice that went out.
//
// Both build their list through `prepareInvoices`, so the window shows
// exactly what is sent. The confirmation is the page's (a bulk action asks
// first); the server's job is to refuse what can't go and say why.
import { NextResponse } from "next/server";
import { getCapableUser } from "@/lib/auth";
import { emailStatus, sendEmails } from "@/lib/email";
import { appBaseUrl } from "@/lib/googleCalendar";
import { prepareInvoices } from "@/lib/invoiceRun";
import { isInvoiceScope } from "@/lib/invoices";
import { prisma } from "@/lib/prisma";
import type { ApiInvoicePreview, ApiInvoiceSendResult } from "@/lib/types";

const FORBIDDEN = "Only the Finance Officer or an admin can send invoices.";
const MAX_MEMBERS = 500;

export async function GET(req: Request) {
  const officer = await getCapableUser("finance:manage");
  if (!officer) return NextResponse.json({ error: FORBIDDEN }, { status: 403 });

  const scope = new URL(req.url).searchParams.get("scope");
  if (!isInvoiceScope(scope)) {
    return NextResponse.json({ error: "Pick a month, or all time." }, { status: 400 });
  }

  const prepared = await prepareInvoices({
    scope,
    memberIds: null,
    officerName: officer.name,
    financesUrl: new URL("/finances", appBaseUrl(req)).toString(),
  });
  const status = emailStatus();
  const payload: ApiInvoicePreview = {
    scope,
    email: { configured: status.configured, reason: status.reason },
    recipients: prepared.map((p) => ({
      member: p.member,
      address: p.address,
      amountDueCents: p.invoice?.amountDueCents ?? 0,
      lineCount: p.invoice?.lineCount ?? 0,
      skipReason: p.skipReason,
      lastSentAt: p.lastSentAt?.toISOString() ?? null,
    })),
  };
  return NextResponse.json(payload);
}

export async function POST(req: Request) {
  const officer = await getCapableUser("finance:manage");
  if (!officer) return NextResponse.json({ error: FORBIDDEN }, { status: 403 });

  const body = await req.json().catch(() => null);
  const scope = body?.scope;
  if (!isInvoiceScope(scope)) {
    return NextResponse.json({ error: "Pick a month, or all time." }, { status: 400 });
  }
  let memberIds: string[] | null = null;
  if (body?.memberIds !== undefined && body?.memberIds !== null) {
    if (!Array.isArray(body.memberIds)) {
      return NextResponse.json({ error: "memberIds must be a list." }, { status: 400 });
    }
    memberIds = body.memberIds.filter((id: unknown): id is string => typeof id === "string");
    if (memberIds!.length === 0) {
      return NextResponse.json({ error: "Pick at least one person." }, { status: 400 });
    }
    if (memberIds!.length > MAX_MEMBERS) {
      return NextResponse.json({ error: "Too many people at once." }, { status: 400 });
    }
  }

  // Refuse before reading anything: there's no partial send to report when
  // the server can't send at all, and "0 sent, 9 failed" says it worse.
  const status = emailStatus();
  if (!status.configured) {
    return NextResponse.json({ error: status.reason }, { status: 503 });
  }

  const prepared = await prepareInvoices({
    scope,
    memberIds,
    officerName: officer.name,
    financesUrl: new URL("/finances", appBaseUrl(req)).toString(),
  });

  const result: ApiInvoiceSendResult = { sent: [], skipped: [], failed: [] };
  const sendable = prepared.filter((p) => !p.skipReason && p.invoice && p.address);
  for (const p of prepared) {
    if (p.skipReason) {
      result.skipped.push({ memberId: p.member.id, name: p.member.name, reason: p.skipReason });
    }
  }

  const outcomes = await sendEmails(
    sendable.map((p) => ({
      to: p.address!,
      subject: p.invoice!.subject,
      text: p.invoice!.text,
      html: p.invoice!.html,
      replyTo: officer.email,
    }))
  );

  const records: { memberId: string; scope: string; amountCents: number; sentTo: string; sentById: string }[] = [];
  sendable.forEach((p, i) => {
    const outcome = outcomes[i];
    if (outcome.ok) {
      result.sent.push({ memberId: p.member.id, name: p.member.name, address: p.address! });
      records.push({
        memberId: p.member.id,
        scope,
        amountCents: p.invoice!.amountDueCents,
        sentTo: p.address!,
        sentById: officer.id,
      });
    } else {
      result.failed.push({ memberId: p.member.id, name: p.member.name, error: outcome.error });
    }
  });
  if (records.length > 0) await prisma.invoiceSend.createMany({ data: records });

  return NextResponse.json(result);
}
