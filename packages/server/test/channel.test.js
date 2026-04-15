/**
 * Channel event tests have been removed.
 *
 * The channel event system (createEmit, createCancel, X-Mctx-Event headers)
 * has been removed from this version of the framework.
 * Handlers now use the (mctx, req, res) pattern with res.send() for results.
 */

import { describe, it } from "vitest";

describe("channel module", () => {
  it("channel event functionality has been removed from this version", () => {
    // Channel events (emit/cancel) are no longer part of the framework.
    // Handlers use (mctx, req, res) with res.send() for returning results.
  });
});
