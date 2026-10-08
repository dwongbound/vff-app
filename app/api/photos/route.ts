// Photo upload. Multipart POST with:
//   file     — the image itself
//   subject  — "flight" | "squawk" | "checkout"
//   subjectId— the row it documents (must already exist and be yours)
//   caption  — optional
//   requestId— optional idempotency key (lib/idempotency.ts): a retried upload
//              that already landed returns that photo instead of storing the
//              bytes a second time
//
// The bytes go to object storage (lib/storage: local disk in dev, an
// S3-compatible bucket in prod) and this table keeps the index. Images are
// read back through /api/photos/[id], which checks the session — so the bucket
// itself never has to be public.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, photoKey, storageStatus } from "@/lib/storage";
import { serializePhoto } from "@/lib/serialize";
import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES } from "@/lib/constants";
import { isUniqueViolation, requestIdFrom } from "@/lib/idempotency";

type Subject = "flight" | "squawk" | "checkout";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // The UI already hides the picker when this is the case (see
  // PhotoSupportProvider), so reaching here means a stale tab or a direct
  // call. 503 rather than the 500 that getStorage()'s throw would produce:
  // nothing is broken, the feature is switched off.
  const storage = storageStatus();
  if (!storage.configured) {
    return NextResponse.json(
      { error: storage.reason ?? "Photo storage is unavailable." },
      { status: 503 }
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file in the upload." }, { status: 400 });
  }
  const subject = String(form.get("subject") ?? "") as Subject;
  const subjectId = String(form.get("subjectId") ?? "");
  const caption = form.get("caption") ? String(form.get("caption")).trim() : null;
  const requestId = requestIdFrom(form.get("requestId"));

  // Checked before anything touches storage, so a retry costs a lookup rather
  // than a second copy of the bytes in the bucket.
  if (requestId) {
    const replay = await alreadyUploaded(requestId, user.id);
    if (replay) return replay;
  }

  if (!["flight", "squawk", "checkout"].includes(subject) || !subjectId) {
    return NextResponse.json(
      { error: "Say what this photo belongs to." },
      { status: 400 }
    );
  }
  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Photos need to be JPEG, PNG, WebP or HEIC." },
      { status: 415 }
    );
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: `That photo is over ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB.` },
      { status: 413 }
    );
  }

  // You may only attach to a row you own — otherwise a member could staple
  // photos onto someone else's flight.
  const owner = await ownerOf(subject, subjectId);
  if (owner === null) {
    return NextResponse.json({ error: "Can't find what that photo belongs to." }, { status: 404 });
  }
  if (owner !== user.id && !user.isAdmin) {
    return NextResponse.json({ error: "That isn't yours." }, { status: 403 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = photoKey(
    subject === "flight" ? "flights" : subject === "squawk" ? "squawks" : "checkouts",
    subjectId,
    file.type
  );

  await getStorage().put(key, bytes, file.type);

  let photo;
  try {
    photo = await prisma.photo.create({
      data: {
        key,
        contentType: file.type,
        sizeBytes: bytes.byteLength,
        caption,
        uploadedById: user.id,
        flightId: subject === "flight" ? subjectId : null,
        squawkId: subject === "squawk" ? subjectId : null,
        checkoutId: subject === "checkout" ? subjectId : null,
        clientRequestId: requestId,
      },
    });
  } catch (error) {
    // Lost a race with another copy of this upload. Its bytes are the ones the
    // index points at, so ours go back out of the bucket.
    if (requestId && isUniqueViolation(error)) {
      await getStorage().delete(key).catch(() => {});
      const raced = await alreadyUploaded(requestId, user.id);
      if (raced) return raced;
    }
    throw error;
  }

  return NextResponse.json(serializePhoto(photo), { status: 201 });
}

/** The photo a retried upload already stored, or null. */
async function alreadyUploaded(requestId: string, userId: string) {
  const row = await prisma.photo.findUnique({ where: { clientRequestId: requestId } });
  if (!row) return null;
  if (row.uploadedById !== userId) {
    return NextResponse.json(
      { error: "That request id belongs to another photo." },
      { status: 409 }
    );
  }
  return NextResponse.json(serializePhoto(row), { status: 200 });
}

/** The user id that owns a subject row, or null when it doesn't exist. */
async function ownerOf(subject: Subject, id: string): Promise<string | null> {
  if (subject === "flight") {
    const row = await prisma.flight.findUnique({
      where: { id },
      select: { userId: true },
    });
    return row?.userId ?? null;
  }
  if (subject === "squawk") {
    const row = await prisma.squawk.findUnique({
      where: { id },
      select: { reportedById: true },
    });
    return row?.reportedById ?? null;
  }
  const row = await prisma.checkout.findUnique({
    where: { id },
    select: { userId: true },
  });
  return row?.userId ?? null;
}
