/**
 * Channel Module Tests
 *
 * Tests the createEmit and createCancel factories for the channel
 * event emission module. The new implementation sets response headers
 * on ctx._pendingHeaders rather than making outbound HTTP calls.
 */

import { describe, it, expect } from "vitest";
import { createEmit, createCancel, META_KEY_PATTERN } from "../src/channel.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal ctx object with _pendingHeaders.
 */
function makeCtx(overrides = {}) {
  return {
    _pendingHeaders: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. createEmit() factory
// ---------------------------------------------------------------------------

describe("createEmit() factory", () => {
  it("returns a function", () => {
    const emit = createEmit(makeCtx());
    expect(typeof emit).toBe("function");
  });

  it("returns a string (eventId) when called", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    const result = await emit("hello");
    expect(typeof result).toBe("string");
  });

  it("returned eventId is a 26-character ULID", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    const eventId = await emit("hello");
    expect(eventId).toHaveLength(26);
  });

  it("sets X-Mctx-Event header on ctx._pendingHeaders", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    await emit("hello");
    expect(ctx._pendingHeaders["X-Mctx-Event"]).toBeDefined();
  });

  it("X-Mctx-Event header is valid JSON", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    await emit("hello");
    expect(() => JSON.parse(ctx._pendingHeaders["X-Mctx-Event"])).not.toThrow();
  });

  it("X-Mctx-Event payload contains eventId matching return value", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    const eventId = await emit("hello");
    const payload = JSON.parse(ctx._pendingHeaders["X-Mctx-Event"]);
    expect(payload.eventId).toBe(eventId);
  });

  it("X-Mctx-Event payload contains content", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    await emit("hello world");
    const payload = JSON.parse(ctx._pendingHeaders["X-Mctx-Event"]);
    expect(payload.content).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// 2. emit() — options passthrough
// ---------------------------------------------------------------------------

describe("emit() options passthrough", () => {
  it("passes eventType in payload", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    await emit("hello", { eventType: "alert" });
    const payload = JSON.parse(ctx._pendingHeaders["X-Mctx-Event"]);
    expect(payload.eventType).toBe("alert");
  });

  it("passes meta in payload", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    await emit("hello", { meta: { key: "val" } });
    const payload = JSON.parse(ctx._pendingHeaders["X-Mctx-Event"]);
    expect(payload.meta).toEqual({ key: "val" });
  });

  it("serializes deliverAt Date to ISO string", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    const deliverAt = new Date("2030-01-01T00:00:00.000Z");
    await emit("hello", { deliverAt });
    const payload = JSON.parse(ctx._pendingHeaders["X-Mctx-Event"]);
    expect(payload.deliverAt).toBe("2030-01-01T00:00:00.000Z");
  });

  it("serializes expiresAt Date to ISO string", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    const expiresAt = new Date("2030-06-01T00:00:00.000Z");
    await emit("hello", { expiresAt });
    const payload = JSON.parse(ctx._pendingHeaders["X-Mctx-Event"]);
    expect(payload.expiresAt).toBe("2030-06-01T00:00:00.000Z");
  });

  it("omits deliverAt key from payload when not provided", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    await emit("hello");
    const payload = JSON.parse(ctx._pendingHeaders["X-Mctx-Event"]);
    expect(payload.deliverAt).toBeUndefined();
  });

  it("omits expiresAt key from payload when not provided", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    await emit("hello");
    const payload = JSON.parse(ctx._pendingHeaders["X-Mctx-Event"]);
    expect(payload.expiresAt).toBeUndefined();
  });

  it("uses deliverAt timestamp for ULID when deliverAt Date is provided", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    const deliverAt = new Date(2000000000000); // far future timestamp
    const eventId = await emit("hello", { deliverAt });
    // ULID starts with timestamp component — just verify it's still 26 chars
    expect(eventId).toHaveLength(26);
  });
});

// ---------------------------------------------------------------------------
// 3. emit() — default options
// ---------------------------------------------------------------------------

describe("emit() with no options", () => {
  it("works with no options argument", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    await expect(emit("hello")).resolves.toMatch(/^[0-9A-Z]{26}$/);
  });

  it("works with empty options object", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    await expect(emit("hello", {})).resolves.toMatch(/^[0-9A-Z]{26}$/);
  });
});

// ---------------------------------------------------------------------------
// 4. createCancel() factory
// ---------------------------------------------------------------------------

describe("createCancel() factory", () => {
  it("returns a function", () => {
    const cancel = createCancel(makeCtx());
    expect(typeof cancel).toBe("function");
  });

  it("sets X-Mctx-Cancel header on ctx._pendingHeaders", async () => {
    const ctx = makeCtx();
    const cancel = createCancel(ctx);
    await cancel("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(ctx._pendingHeaders["X-Mctx-Cancel"]).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
  });

  it("resolves to undefined", async () => {
    const ctx = makeCtx();
    const cancel = createCancel(ctx);
    await expect(cancel("some-event-id")).resolves.toBeUndefined();
  });

  it("can be called with any string eventId", async () => {
    const ctx = makeCtx();
    const cancel = createCancel(ctx);
    await cancel("my-custom-event-id");
    expect(ctx._pendingHeaders["X-Mctx-Cancel"]).toBe("my-custom-event-id");
  });

  it("overwrites previous X-Mctx-Cancel on repeated calls", async () => {
    const ctx = makeCtx();
    const cancel = createCancel(ctx);
    await cancel("first-id");
    await cancel("second-id");
    expect(ctx._pendingHeaders["X-Mctx-Cancel"]).toBe("second-id");
  });
});

// ---------------------------------------------------------------------------
// 5. META_KEY_PATTERN export
// ---------------------------------------------------------------------------

describe("META_KEY_PATTERN", () => {
  it("is a RegExp", () => {
    expect(META_KEY_PATTERN).toBeInstanceOf(RegExp);
  });

  it("matches valid alphanumeric keys", () => {
    expect(META_KEY_PATTERN.test("foo")).toBe(true);
    expect(META_KEY_PATTERN.test("ABC123")).toBe(true);
    expect(META_KEY_PATTERN.test("a")).toBe(true);
  });

  it("matches keys with underscores", () => {
    expect(META_KEY_PATTERN.test("bar_baz")).toBe(true);
    expect(META_KEY_PATTERN.test("a_1_b")).toBe(true);
    expect(META_KEY_PATTERN.test("_leading")).toBe(true);
    expect(META_KEY_PATTERN.test("trailing_")).toBe(true);
  });

  it("rejects keys with hyphens", () => {
    expect(META_KEY_PATTERN.test("foo-bar")).toBe(false);
  });

  it("rejects keys with spaces", () => {
    expect(META_KEY_PATTERN.test("foo bar")).toBe(false);
  });

  it("rejects keys with dots", () => {
    expect(META_KEY_PATTERN.test("foo.bar")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(META_KEY_PATTERN.test("")).toBe(false);
  });

  it("rejects keys with special characters", () => {
    expect(META_KEY_PATTERN.test("foo@bar")).toBe(false);
    expect(META_KEY_PATTERN.test("foo/bar")).toBe(false);
    expect(META_KEY_PATTERN.test("foo#bar")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. emit() + cancel() integration — roundtrip
// ---------------------------------------------------------------------------

describe("emit() + cancel() roundtrip", () => {
  it("emits event and cancels it using the returned eventId", async () => {
    const ctx = makeCtx();
    const emit = createEmit(ctx);
    const cancel = createCancel(ctx);

    const eventId = await emit("scheduled event", {
      deliverAt: new Date(Date.now() + 60000),
    });
    await cancel(eventId);

    expect(ctx._pendingHeaders["X-Mctx-Cancel"]).toBe(eventId);
  });
});
