import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 64 * 1024;

function reject(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

async function guardPost(req: Request): Promise<Request | Response> {
  const url = new URL(req.url);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (url.port === "") {
    hosts.add("127.0.0.1");
    hosts.add("localhost");
  }
  // NextURL normalizes loopback IPs to localhost; validate the external Host
  // explicitly, then compare Origin to that validated host, not the normalized URL.
  const host = req.headers.get("host") ?? url.host;
  if (!hosts.has(host)) {
    return reject(403, "Host must name this loopback server and port.");
  }
  const origin = req.headers.get("origin");
  if (
    origin !== null &&
    origin !== new URL(`${url.protocol}//${host}`).origin
  ) {
    return reject(403, "Foreign origins are not allowed.");
  }
  if (
    !/^application\/json(?:\s*;|\s*$)/i.test(
      req.headers.get("content-type") ?? "",
    )
  ) {
    return reject(415, "POST requests must use application/json.");
  }
  const length = req.headers.get("content-length");
  if (length !== null) {
    if (!/^\d+$/.test(length)) return reject(400, "Invalid content length.");
    if (Number(length) > MAX_BODY_BYTES) {
      return reject(413, "Request body exceeds 64 KiB.");
    }
  }

  const reader = req.body?.getReader();
  if (!reader) return new Request(req, { body: "" });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return reject(413, "Request body exceeds 64 KiB.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return new Request(req, { body });
  } catch {
    return reject(400, "Invalid request body.");
  } finally {
    reader.releaseLock();
  }
}

const handler = async (req: Request): Promise<Response> => {
  const guarded = req.method === "POST" ? await guardPost(req) : req;
  if (guarded instanceof Response) return guarded;
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: guarded,
    router: appRouter,
    createContext: () => createTRPCContext({ headers: req.headers }),
  });
};

export { handler as GET, handler as POST };
