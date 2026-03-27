/**
 * Channel Event Emission Module
 *
 * Enables MCP servers to push real-time events to mctx channel subscribers.
 * Provides the `emit` function for tools via `ctx.emit` and the `cancel`
 * function via `ctx.cancel` for cancelling pending scheduled events.
 *
 * Events are delivered via response headers (X-Mctx-Event, X-Mctx-Cancel)
 * intercepted by the mctx dispatch worker — no outbound HTTP calls are made.
 *
 * @module channel
 */

import { generateUlid } from "./ulid.js";

/**
 * Regex pattern for valid metadata keys.
 * Keys must consist of alphanumeric characters and underscores only.
 * Hyphens are silently dropped by some environments, so we reject them explicitly.
 */
export const META_KEY_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * Creates an emit function bound to the given ctx object.
 *
 * Sets X-Mctx-Event on ctx._pendingHeaders with the serialized event payload.
 * Returns the generated eventId so callers can reference or cancel the event.
 *
 * @param {Object} ctx - Request context object with _pendingHeaders
 * @returns {Function} Async emit function that returns eventId string
 *
 * @example
 * const emit = createEmit(ctx);
 * const eventId = await emit("User completed onboarding", { eventType: "milestone" });
 */
export function createEmit(ctx) {
  return async function emit(content, options = {}) {
    const eventId = generateUlid(options.deliverAt?.getTime());
    const payload = JSON.stringify({
      eventId,
      content,
      ...options,
      deliverAt: options.deliverAt?.toISOString(),
      expiresAt: options.expiresAt?.toISOString(),
    });
    ctx._pendingHeaders["X-Mctx-Event"] = payload;
    return eventId;
  };
}

/**
 * Creates a cancel function bound to the given ctx object.
 *
 * Sets X-Mctx-Cancel on ctx._pendingHeaders with the eventId to cancel.
 *
 * @param {Object} ctx - Request context object with _pendingHeaders
 * @returns {Function} Async cancel function
 *
 * @example
 * const cancel = createCancel(ctx);
 * await cancel(eventId);
 */
export function createCancel(ctx) {
  return async function cancel(eventId) {
    ctx._pendingHeaders["X-Mctx-Cancel"] = eventId;
  };
}
