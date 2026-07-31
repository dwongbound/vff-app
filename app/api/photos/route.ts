// Photo upload. Multipart POST with:
//   file     — the image itself
//   subject  — "flight" | "squawk" | "preflight"
//   subjectId— the row it documents (must already exist and be yours)
//   caption  — optional
//
// The bytes go to object storage (lib/storage: local disk in dev, an
// S3-compatible bucket in prod) and this table keeps the index. Images are
// read back through /api/photos/[id], which checks the session — so the bucket
// itself never has to be public.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, photoKey } from "@/lib/storage";
import { serializePhoto } from "@/lib/serialize";
import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES } from "@/lib/constants";

type Subject = "flight" | "squawk" | "preflight";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

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

  if (!["flight", "squawk", "preflight"].includes(subject) || !subjectId) {
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
    subject === "flight" ? "flights" : subject === "squawk" ? "squawks" : "preflight",
    subjectId,
    file.type
  );

  await getStorage().put(key, bytes, file.type);

  const photo = await prisma.photo.create({
    data: {
      key,
      contentType: file.type,
      sizeBytes: bytes.byteLength,
      caption,
      uploadedById: user.id,
      flightId: subject === "flight" ? subjectId : null,
      squawkId: subject === "squawk" ? subjectId : null,
      preflightId: subject === "preflight" ? subjectId : null,
    },
  });

  return NextResponse.json(serializePhoto(photo), { status: 201 });
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
  const row = await prisma.preflightCheck.findUnique({
    where: { id },
    select: { userId: true },
  });
  return row?.userId ?? null;
}
