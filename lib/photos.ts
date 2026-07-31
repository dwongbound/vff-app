// Keeping stored bytes and Photo rows in step.
//
// Deleting a parent row (a flight, say) cascades its Photo rows away in the
// database, but object storage knows nothing about that cascade — without this
// helper every deleted flight would leave its images behind forever, and the
// bucket would only ever grow. Anything that deletes a row owning photos calls
// `purgePhotosFor` first.
import { prisma } from "./prisma";
import { getStorage } from "./storage";

type Owner =
  | { flightId: string }
  | { squawkId: string }
  | { preflightId: string };

/**
 * Delete the stored objects for every photo attached to `owner`, leaving the
 * rows for the caller's own delete (or its cascade) to remove.
 *
 * Each object delete is best-effort: a storage hiccup must not block deleting
 * the flight. The failure mode we accept (a stray object) is strictly better
 * than the one we're preventing (an unreachable object that nothing will ever
 * clean up), and it's the direction that never leaves a row pointing at bytes
 * that are already gone.
 */
export async function purgePhotosFor(owner: Owner): Promise<void> {
  const photos = await prisma.photo.findMany({
    where: owner,
    select: { key: true },
  });
  if (photos.length === 0) return;

  const storage = getStorage();
  await Promise.all(
    photos.map((photo) =>
      storage.delete(photo.key).catch((error) => {
        console.error(`[photos] could not delete ${photo.key}`, error);
      })
    )
  );
}
