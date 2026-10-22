import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import baseline from "../../examples/contour-baseline.json";
import { GET, POST } from "~/app/api/trpc/[trpc]/route";
import * as geometry from "~/lib/geometry";
import { type ContourInput, type LastState } from "~/lib/geometry/types";

const base = "http://127.0.0.1:3000/api/trpc/last";
type ErrorResponse = {
  error: {
    json: {
      message: string;
      data: {
        code: string;
        httpStatus: number;
        reports: LastState["reports"] | null;
        stack?: string;
      };
    };
  };
};

function post(input: unknown, headers: HeadersInit = {}): Promise<Response> {
  return POST(
    new Request(`${base}.rebuild`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ json: input }),
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("tRPC HTTP route", () => {
  it("serves defaults as a GET query", async () => {
    const response = await GET(new Request(`${base}.defaults`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { data: { json: ContourInput } };
    };
    expect(body.result.data.json).toEqual(baseline);
  });

  it("accepts a current contour document and returns shared-core results", async () => {
    const response = await post(baseline);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { data: { json: LastState } };
    };
    expect(body.result.data.json).toEqual(geometry.buildLast(baseline));
  });

  it.each([
    null,
    [],
    "input",
    { top: {}, bottom: {} },
    { ...baseline, extra: 1 },
  ])(
    "rejects invalid or legacy JSON input without models: %j",
    async (input) => {
      const response = await post(input);
      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error.json.data.code).toBe("BAD_REQUEST");
      expect(body.error.json.data.stack).toBeUndefined();
      expect(body).not.toHaveProperty("result");
    },
  );

  it("does not allow mutations over GET", async () => {
    const response = await GET(new Request(`${base}.rebuild`));
    expect(response.status).toBe(405);
  });

  it("requires JSON for POST", async () => {
    expect(
      (await post(baseline, { "content-type": "text/plain" })).status,
    ).toBe(415);
  });

  it("rejects a foreign Origin and mismatched Host", async () => {
    expect(
      (await post(baseline, { origin: "https://foreign.example" })).status,
    ).toBe(403);
    expect((await post(baseline, { host: "foreign.example" })).status).toBe(
      403,
    );
    expect(
      (await post(baseline, { origin: "http://127.0.0.1:3000" })).status,
    ).toBe(200);
  });

  it.each([3000, 3147])(
    "accepts a real NextRequest normalized from 127.0.0.1 on port %i",
    async (port) => {
      const origin = `http://127.0.0.1:${port}`;
      const request = new NextRequest(`${origin}/api/trpc/last.rebuild`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: `127.0.0.1:${port}`,
          origin,
        },
        body: JSON.stringify({ json: baseline }),
      });
      expect(new URL(request.url).hostname).toBe("localhost");
      expect(request.headers.get("host")).toBe(`127.0.0.1:${port}`);
      expect((await POST(request)).status).toBe(200);
    },
  );

  it.each([
    { host: "localhost:3000", origin: "http://localhost:3000" },
    { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
  ])("accepts the validated local Host/Origin pair %j", async (headers) => {
    expect((await post(baseline, headers)).status).toBe(200);
  });

  it.each<Record<string, string>>([
    { host: "rebound.example:3000", origin: "http://rebound.example:3000" },
    { host: "127.0.0.1:3147", origin: "http://127.0.0.1:3147" },
    { host: "localhost:3147" },
    { host: "127.0.0.1:3000", origin: "http://localhost:3000" },
    { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3147" },
    { host: "127.0.0.1:3000", origin: "null" },
    { host: "127.0.0.1:3000", origin: "https://foreign.example" },
    { host: "localhost:3000, rebound.example:3000" },
    { host: "127.0.0.1.evil.example:3000" },
    { host: "user@localhost:3000" },
    { host: "127.0.0.2:3000" },
    { host: "[::1]:3000" },
    { host: "localhost:3000", origin: "http://localhost:3000/" },
  ])("rejects unsafe or mismatched local authorities %j", async (headers) => {
    expect((await post(baseline, headers)).status).toBe(403);
  });

  it("does not trust forwarded authority headers to bypass Host/Origin checks", async () => {
    expect(
      (
        await post(baseline, {
          host: "foreign.example:3000",
          origin: "http://foreign.example:3000",
          "x-forwarded-host": "127.0.0.1:3000",
          "x-forwarded-proto": "http",
        })
      ).status,
    ).toBe(403);
  });

  it("rejects declared oversized bodies", async () => {
    expect((await post(baseline, { "content-length": "65537" })).status).toBe(
      413,
    );
  });

  it("enforces the byte limit on streams without Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(40_000).fill(32));
        controller.enqueue(new Uint8Array(40_000).fill(32));
        controller.close();
      },
    });
    const request = new Request(`${base}.rebuild`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(request.headers.has("content-length")).toBe(false);
    expect((await POST(request)).status).toBe(413);
  });

  it("does not trust an understated Content-Length", async () => {
    const response = await POST(
      new Request(`${base}.rebuild`, {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "1" },
        body: " ".repeat(65_537),
      }),
    );
    expect(response.status).toBe(413);
  });

  it.each(["{", '{"json":NaN}', '{"json":Infinity}'])(
    "rejects malformed JSON: %s",
    async (body) => {
      const response = await POST(
        new Request(`${base}.rebuild`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      );
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).not.toContain('"stack"');
      expect(text).not.toContain('"result"');
    },
  );

  it("rejects invalid UTF-8", async () => {
    const response = await POST(
      new Request(`${base}.rebuild`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new Uint8Array([255]),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("never leaks unexpected messages or development stacks", async () => {
    vi.spyOn(geometry, "buildLast").mockImplementationOnce(() => {
      throw new Error("private /server/secret/path");
    });
    const response = await post(baseline);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("Unable to rebuild last.");
    expect(text).not.toContain("secret");
    expect(text).not.toContain('"stack"');
    expect(text).not.toContain('"result"');
  });

  it.each(["top", "bottom", "contour"] as const)(
    "returns 422 reports without models when the %s report fails",
    async (name) => {
      const state = geometry.buildLast(baseline);
      state.reports[name].passed = false;
      vi.spyOn(geometry, "buildLast").mockImplementationOnce(() => {
        throw new geometry.GeometryValidationError(state.reports);
      });
      const response = await post(baseline);
      expect(response.status).toBe(422);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error.json.data.code).toBe("UNPROCESSABLE_CONTENT");
      expect(body.error.json.data.reports?.[name].passed).toBe(false);
      expect(body.error.json.data.stack).toBeUndefined();
      expect(body).not.toHaveProperty("result");
      expect(JSON.stringify(body)).not.toContain('"models"');
    },
  );

  it("keeps unexpected parser failures internal", async () => {
    vi.spyOn(geometry, "parseContourInput").mockImplementationOnce(() => {
      throw new Error("private /server/parser/path");
    });
    const response = await post(baseline);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("Unable to rebuild last.");
    expect(text).not.toContain("private");
    expect(text).not.toContain('"stack"');
  });
});
