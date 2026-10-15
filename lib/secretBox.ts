// A credential at rest: AES-256-GCM under a key derived from the app's own
// secret. Used for the club's Google refresh token (GoogleConnection), which
// can edit the airplane's calendar — a database dump on its own shouldn't be
// enough to do that.
//
// The key is derived (HKDF) from NEXTAUTH_SECRET rather than being a new
// variable, so there's nothing extra to provision; the cost is that rotating
// that secret orphans the stored token, and the fix is to reconnect from Club
// settings, which `openBox` returning null makes the obvious next step.
//
// Server-only: node:crypto. Takes the secret as a parameter so it's testable.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const INFO = "vff-app/google-refresh-token/v1";

/** A 32-byte AES key derived from the app secret, scoped by `INFO`. */
function keyFrom(secret: string): Buffer {
  if (!secret) throw new Error("No secret to derive an encryption key from.");
  return Buffer.from(hkdfSync("sha256", secret, "", INFO, 32));
}

/** "v1.<iv>.<tag>.<ciphertext>", each part base64url. */
export function sealBox(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

/** The plaintext, or null for anything that doesn't open under this secret. */
export function openBox(sealed: string, secret: string): string | null {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFrom(secret),
      Buffer.from(iv, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
