// The db half of lib/squawkAlert.ts: read who to tell, and tell them.
//
// Called from POST /api/squawks inside `after()`, so the member filing from
// the ramp never waits on a mail server, and NEVER throws — a squawk that
// landed is a squawk that landed, whatever the mail service says. A failure
// goes to the server log, which is where a silent miss would otherwise vanish.
import { emailStatus, sendEmails } from "./email";
import { prisma } from "./prisma";
import { invoiceAddress } from "./invoices";
import { squawkAlertEmail, squawkAlertRecipients } from "./squawkAlert";

export async function alertSafetyOfficers(squawkId: string, baseUrl: string): Promise<void> {
  try {
    const status = emailStatus();
    if (!status.configured) {
      console.warn(`[squawk-alert] not sent for ${squawkId}: ${status.reason}`);
      return;
    }

    const squawk = await prisma.squawk.findUnique({
      where: { id: squawkId },
      select: {
        id: true,
        title: true,
        description: true,
        createdAt: true,
        reportedById: true,
        aircraft: { select: { tailNumber: true } },
        reportedBy: { select: { name: true, email: true, username: true } },
      },
    });
    if (!squawk) return;

    const people = await prisma.user.findMany({
      where: { OR: [{ positions: { has: "SAFETY_OFFICER" } }, { isAdmin: true }] },
      select: { id: true, email: true, username: true, isAdmin: true, positions: true },
    });
    const { addresses, fallback } = squawkAlertRecipients(people, squawk.reportedById);
    if (addresses.length === 0) return;

    const message = squawkAlertEmail({
      tailNumber: squawk.aircraft.tailNumber,
      title: squawk.title,
      description: squawk.description,
      reporterName: squawk.reportedBy.name,
      filedAt: squawk.createdAt,
      squawkUrl: new URL(`/status/squawks#${squawk.id}`, baseUrl).toString(),
      fallback,
    });
    // Replies go to the member who saw it — the officer's first question is
    // usually "where exactly, and how bad".
    const replyTo = invoiceAddress(squawk.reportedBy);

    const outcomes = await sendEmails(addresses.map((to) => ({ to, ...message, replyTo })));
    outcomes.forEach((outcome, i) => {
      if (!outcome.ok) {
        console.error(`[squawk-alert] ${squawkId} → ${addresses[i]} failed: ${outcome.error}`);
      }
    });
  } catch (error) {
    console.error(`[squawk-alert] ${squawkId} failed`, error);
  }
}
