import "server-only";

import { z } from "zod";

const MAX_LOGIN_BODY_BYTES = 4 * 1_024;
const LoginBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(8).max(256),
  })
  .strict();

function declaredBodyLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (value === null) return null;
  if (!/^(0|[1-9]\d*)$/.test(value)) return Number.NaN;
  return Number(value);
}

export async function readBoundedLoginBody(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    Buffer.byteLength(contentType, "utf8") > 256 ||
    contentType.split(";", 1)[0]?.trim() !== "application/json" ||
    ![null, "identity"].includes(request.headers.get("content-encoding"))
  ) {
    return { ok: false as const, status: 415, code: "UNSUPPORTED_MEDIA_TYPE" };
  }

  const declaredLength = declaredBodyLength(request);
  if (declaredLength !== null && !Number.isSafeInteger(declaredLength)) {
    return { ok: false as const, status: 400, code: "INVALID_REQUEST" };
  }
  if (declaredLength !== null && declaredLength > MAX_LOGIN_BODY_BYTES) {
    return { ok: false as const, status: 413, code: "PAYLOAD_TOO_LARGE" };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false as const, status: 400, code: "INVALID_JSON" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_LOGIN_BODY_BYTES) {
        await reader.cancel();
        return { ok: false as const, status: 413, code: "PAYLOAD_TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false as const, status: 400, code: "INVALID_JSON" };
  } finally {
    reader.releaseLock();
  }

  try {
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed = LoginBodySchema.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    return parsed.success
      ? { ok: true as const, body: parsed.data }
      : { ok: false as const, status: 422, code: "INVALID_REQUEST" };
  } catch {
    return { ok: false as const, status: 400, code: "INVALID_JSON" };
  }
}
