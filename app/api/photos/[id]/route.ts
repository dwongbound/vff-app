// Serve or delete one photo.
//
// GET streams the bytes out of storage behind the session check — this is what
// lets the bucket stay private. Club photos (a scraped wingtip, a fuel
// receipt) are all readable by any signed-in member; deleting is restricted to
// whoever uploaded it, or an admin.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage } from "@/lib/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const photo = await prisma.photo.findUnique({
    where: { id },
    select: { key: true, contentType: true },
  });
  if (!photo) return NextResponse.json({ error: "No such photo." }, { status: 404 });

  const object = await getStorage().get(photo.key);
  if (!object) {
    // The row outlived its bytes (bucket wiped, local dir not persisted).
    return NextResponse.json({ error: "Photo bytes are missing." }, { status: 404 });
  }

  return new NextResponse(object.bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": object.contentType || photo.contentType,
      "Content-Length": String(object.bytes.byteLength),
      // Private: it's behind auth, so only the member's own browser may cache
      // it — never a shared proxy. Immutable because a photo id never points
      // at different bytes.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const photo = await prisma.photo.findUnique({
    where: { id },
    select: { id: true, key: true, uploadedById: true },
  });
  if (!photo) return NextResponse.json({ error: "No such photo." }, { status: 404 });
  if (photo.uploadedById !== user.id && !user.isAdmin) {
    return NextResponse.json({ error: "That isn't your photo." }, { status: 403 });
  }

  // Bytes first: if storage fails we keep the row, so nothing is orphaned in
  // the direction that would leave an unreachable object behind.
  await getStorage().delete(photo.key);
  await prisma.photo.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
