/**
 * Issue #64: slots are labelled in the shop's IANA timezone, not the
 * viewer's. The stored instant never changes when the label (or the zone)
 * does; an unknown zone is rejected.
 */
import "./testConfigEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  InvalidTimezoneError,
  getOwnProviderProfile,
  getPublicProviderProfile,
  updateProviderTimezone,
} from "../src/services/profile.js";
import { formatSlotInTimeZone, isValidTimeZone } from "../src/services/timezone.js";
import { replaceFutureSlots } from "../src/db/availabilitySlots.js";
import { closeDatabase, openTestDatabase, seedProviderProfile } from "./helpers.js";

/** 2026-09-21T12:00:00Z -- a Monday, 15:00 in Europe/Istanbul (UTC+3). */
const FIXTURE_INSTANT = Math.floor(Date.UTC(2026, 8, 21, 12, 0, 0) / 1000);

test("formatSlotInTimeZone renders 15:00 Europe/Istanbul for a fixture instant", () => {
  const label = formatSlotInTimeZone(FIXTURE_INSTANT, "Europe/Istanbul");
  assert.equal(label.time, "15:00");
  assert.equal(label.weekday, "Mon");
  assert.equal(label.timeZone, "Europe/Istanbul");
  assert.equal(label.label, "Mon 15:00 (Europe/Istanbul)");

  // A viewer whose own zone is UTC still sees the shop's zone, not theirs.
  assert.equal(formatSlotInTimeZone(FIXTURE_INSTANT, "Europe/Istanbul").time, "15:00");
  assert.equal(formatSlotInTimeZone(FIXTURE_INSTANT, "UTC").time, "12:00");
});

test("isValidTimeZone accepts an IANA zone and rejects an unknown one", () => {
  assert.equal(isValidTimeZone("Europe/Istanbul"), true);
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
  assert.equal(isValidTimeZone(""), false);
});

test("a shop's timezone can be set; stored slot instants do not change", async () => {
  const result = openTestDatabase();
  try {
    const walletAddress = "GTIMEZONESHOPWALLET";
    const providerProfileId = await seedProviderProfile(result, { walletAddress, isApproved: true });
    const now = Math.floor(Date.now() / 1000);
    await replaceFutureSlots(result.db, providerProfileId, [FIXTURE_INSTANT + 86_400 * 3], now);

    // The default is the zone the hours grid already used.
    const initial = await getOwnProviderProfile(result.db, walletAddress, now);
    assert.equal(initial.timezone, "Europe/Istanbul");
    const storedInstants = [...initial.slots];

    const updated = await updateProviderTimezone(result.db, walletAddress, "America/New_York", now);
    assert.equal(updated.timezone, "America/New_York");
    // The stored instant is untouched -- only its label would change.
    assert.deepEqual(updated.slots, storedInstants);

    const publicView = await getPublicProviderProfile(result.db, providerProfileId, now);
    assert.equal(publicView.timezone, "America/New_York");
    assert.deepEqual(publicView.slots, storedInstants);
  } finally {
    closeDatabase(result);
  }
});

test("an unknown timezone is rejected and nothing is saved", async () => {
  const result = openTestDatabase();
  try {
    const walletAddress = "GTIMEZONESHOPWALLET2";
    await seedProviderProfile(result, { walletAddress, isApproved: true });

    await assert.rejects(
      () => updateProviderTimezone(result.db, walletAddress, "Mars/Olympus"),
      InvalidTimezoneError,
    );
    const profile = await getOwnProviderProfile(result.db, walletAddress);
    assert.equal(profile.timezone, "Europe/Istanbul");
  } finally {
    closeDatabase(result);
  }
});
