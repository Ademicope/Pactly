import assert from "node:assert/strict";
import { test } from "node:test";

import { isWithinBookingWindow } from "../src/services/bookingWindow.js";

test("a slot past the configured booking horizon is not offered", () => {
  const now = 1_000_000;
  assert.equal(isWithinBookingWindow(now + 30 * 86_400, now, 30), true);
  assert.equal(isWithinBookingWindow(now + 30 * 86_400 + 1, now, 30), false);
});

test("a blank booking horizon keeps today's unlimited behavior", () => {
  assert.equal(isWithinBookingWindow(9_000_000_000, 1_000_000, null), true);
});
