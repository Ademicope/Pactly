import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPublicHours } from "../src/services/publicHours.js";

test("public hours render a fixture week and name a closed weekday", () => {
  const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  const hours = buildPublicHours([
    epoch("2026-11-23T09:00:00Z"),
    epoch("2026-11-23T10:00:00Z"),
    epoch("2026-11-25T14:00:00Z"),
  ], 30, "UTC");

  assert.deepEqual(hours[0], { weekday: "Monday", hours: "09:00–10:30" });
  assert.deepEqual(hours[1], { weekday: "Tuesday", hours: "Closed" });
  assert.deepEqual(hours[2], { weekday: "Wednesday", hours: "14:00–14:30" });
});

test("an empty weekly pattern is entirely closed so the card can say hours unset", () => {
  assert.equal(buildPublicHours([], 30).every((day) => day.hours === "Closed"), true);
});
