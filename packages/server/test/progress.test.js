/**
 * Progress Tests
 *
 * Tests progress reporting via res.progress() in tool handlers.
 * The old generator-based createProgress module has been removed.
 * Progress is now reported by calling res.progress(current, total?) from within a handler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer } from "../src/index.js";

// Helper to create mock Request
function createRequest(body) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("res.progress() in tool handlers", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Mock fetch for progress notifications (fire-and-forget)
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("tool handler can call res.progress() without error", async () => {
    const server = createServer();

    const progressTool = async (_mctx, _req, res) => {
      res.progress(1, 3);
      res.progress(2, 3);
      res.progress(3, 3);
      res.send("done");
    };
    progressTool.input = {};
    server.tool("progress-tool", progressTool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "progress-tool", arguments: {} },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.content[0].text).toBe("done");
  });

  it("res.progress() accepts current without total (indeterminate)", async () => {
    const server = createServer();

    const progressTool = async (_mctx, _req, res) => {
      res.progress(1);
      res.progress(2);
      res.send("indeterminate done");
    };
    progressTool.input = {};
    server.tool("indeterminate", progressTool);

    const request = createRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "indeterminate", arguments: {} },
    });

    const response = await server.fetch(request);
    const data = await response.json();

    expect(data.result.content[0].text).toBe("indeterminate done");
  });
});
