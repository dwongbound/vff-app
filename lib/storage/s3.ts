// S3-compatible driver — Cloudflare R2, AWS S3, Backblaze B2, MinIO.
//
// It signs requests with SigV4 using node:crypto and plain fetch instead of
// pulling in the AWS SDK: the app only ever does PUT / GET / DELETE on a single
// object, and the SDK is a ~10 MB dependency for three requests.
//
// Addressing: when S3_ENDPOINT is set we use path style
// (`<endpoint>/<bucket>/<key>`), which is what R2 and MinIO expect. With no
// endpoint we build AWS's virtual-host URL (`<bucket>.s3.<region>.amazonaws.com`).
import { createHash, createHmac } from "node:crypto";
import type { StorageDriver, StoredObject } from "./types";

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Custom endpoint, e.g. https://<accountid>.r2.cloudflarestorage.com */
  endpoint?: string;
  /** Force path-style even against the AWS endpoint (rarely needed). */
  forcePathStyle?: boolean;
}

const SERVICE = "s3";
const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC 3986 encoding for a key path — S3 wants each segment escaped, "/" kept. */
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
      )
    )
    .join("/");
}

export function createS3Driver(config: S3Config): StorageDriver {
  const endpoint = config.endpoint?.replace(/\/+$/, "");
  const pathStyle = Boolean(endpoint) || config.forcePathStyle === true;

  // → { url, host, path } for one object key.
  function target(key: string): { url: string; host: string; path: string } {
    const encoded = encodeKey(key);
    if (endpoint) {
      const base = new URL(endpoint);
      const path = pathStyle
        ? `/${config.bucket}/${encoded}`
        : `/${encoded}`;
      const host = pathStyle
        ? base.host
        : `${config.bucket}.${base.host}`;
      return { url: `${base.protocol}//${host}${path}`, host, path };
    }
    const host = pathStyle
      ? `s3.${config.region}.amazonaws.com`
      : `${config.bucket}.s3.${config.region}.amazonaws.com`;
    const path = pathStyle ? `/${config.bucket}/${encoded}` : `/${encoded}`;
    return { url: `https://${host}${path}`, host, path };
  }

  // Build the Authorization header for one request. Only the three headers we
  // actually send are signed (host, x-amz-content-sha256, x-amz-date), which
  // keeps the canonical request short and predictable.
  function sign(
    method: string,
    host: string,
    path: string,
    payloadHash: string,
    extraHeaders: Record<string, string> = {}
  ): Record<string, string> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20260731T041500Z
    const dateStamp = amzDate.slice(0, 8);

    const headers: Record<string, string> = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...Object.fromEntries(
        Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])
      ),
    };

    const sortedKeys = Object.keys(headers).sort();
    const canonicalHeaders =
      sortedKeys.map((k) => `${k}:${headers[k].trim()}\n`).join("");
    const signedHeaders = sortedKeys.join(";");

    const canonicalRequest = [
      method,
      path,
      "", // no query string on any request we make
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${config.region}/${SERVICE}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const kDate = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, config.region);
    const kService = hmac(kRegion, SERVICE);
    const kSigning = hmac(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning)
      .update(stringToSign, "utf8")
      .digest("hex");

    return {
      ...headers,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  return {
    name: "s3",

    async put(key, bytes, contentType) {
      const { url, host, path } = target(key);
      const payloadHash = sha256Hex(bytes);
      const headers = sign("PUT", host, path, payloadHash, {
        "content-type": contentType,
      });
      const res = await fetch(url, {
        method: "PUT",
        headers,
        body: bytes as unknown as BodyInit,
      });
      if (!res.ok) {
        throw new Error(
          `S3 upload failed (${res.status}): ${await res.text().catch(() => "")}`
        );
      }
    },

    async get(key): Promise<StoredObject | null> {
      const { url, host, path } = target(key);
      const headers = sign("GET", host, path, EMPTY_SHA256);
      const res = await fetch(url, { method: "GET", headers });
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`S3 download failed (${res.status}).`);
      }
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType:
          res.headers.get("content-type") ?? "application/octet-stream",
      };
    },

    async delete(key) {
      const { url, host, path } = target(key);
      const headers = sign("DELETE", host, path, EMPTY_SHA256);
      const res = await fetch(url, { method: "DELETE", headers });
      // 204 on success, 404 when it's already gone — neither is an error here.
      if (!res.ok && res.status !== 404) {
        throw new Error(`S3 delete failed (${res.status}).`);
      }
    },
  };
}
