/**
 * Issue #65: a weekday break with a start and an end inside one working
 * range. Slots are not offered during the break; the hours before and after
 * stay bookable; a break outside the range and two overlapping breaks are
 * rejected; a locked booking inside the new break is kept and listed.
 */
import "./testConfigEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";

import { InvalidBreaksError } from "../src/services/availability.js";
import {
  getOwnProviderProfile,
  getPublicProviderProfile,
  setProviderBreaks,
  updateProviderAvailability,
} from "../src/services/profile.js";
import { getSlotByProviderAndStart, replaceFutureSlots } from "../src/db/availabilitySlots.js";
import { getBookingById, insertBooking, updateEscrowStateSync } from "../src/db/bookings.js";
import { closeDatabase, openTestDatabase, seedProviderProfile } from "./helpers.js";

/** The next Monday's `utcHour:00` in UTC. Europe/Istanbul is UTC+3 all year,
 * so Monday 08:00Z is Monday 11:00 in the shop's own wall clock. */
function nextMondayAtUtcHour(utcHour: number): number {
  const candidate = new Date();
  candidate.setUTCHours(utcHour, 0, 0, 0);
  while (candidate.getUTCDay() !== 1 || candidate.getTime() / 1000 <= Date.now() / 1000 + 3600) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return Math.floor(candidate.getTime() / 1000);
}

const MONDAY = 1;

test("offers 11:00 and 15:00 but not 13:30 when the break is 13:00-14:00", async () => {
  const result = openTestDatabase();
  try {
    const walletAddress = "GBREAKSHOPWALLET";
    const providerProfileId = await seedProviderProfile(result, { walletAddress, isApproved: true });
    const now = Math.floor(Date.now() / 1000);
    const eleven = nextMondayAtUtcHour(8); // 11:00 Istanbul
    const thirteenThirty = eleven + 2.5 * 3600; // 13:30 Istanbul
    const fifteen = eleven + 4 * 3600; // 15:00 Istanbul

    // A continuous working range, 11:00-15:00, with three candidate starts.
    await updateProviderAvailability(result.db, walletAddress, [eleven, thirteenThirty, fifteen], now);
    const before = await getOwnProviderProfile(result.db, walletAddress, now);
    assert.deepEqual(before.slots, [eleven, thirteenThirty, fifteen]);

    const saved = await setProviderBreaks(
      result.db,
      walletAddress,
      [{ weekday: MONDAY, startMinute: 13 * 60, endMinute: 14 * 60 }],
      now,
    );
    assert.deepEqual(saved.slots, [eleven, fifteen]);
    assert.deepEqual(saved.breaks, [{ weekday: MONDAY, startMinute: 13 * 60, endMinute: 14 * 60 }]);

    // The public profile no longer offers the break's slot either.
    const publicView = await getPublicProviderProfile(result.db, providerProfileId, now);
    assert.deepEqual(publicView.slots, [eleven, fifteen]);

    // Saving the same three candidates again still drops the break's slot.
    await updateProviderAvailability(result.db, walletAddress, [eleven, thirteenThirty, fifteen], now);
    const after = await getOwnProviderProfile(result.db, walletAddress, now);
    assert.deepEqual(after.slots, [eleven, fifteen]);
  } finally {
    closeDatabase(result);
  }
});

test("a break that starts before the range or ends after it is rejected", async () => {
  const result = openTestDatabase();
  try {
    const walletAddress = "GBREAKSHOPWALLET2";
    await seedProviderProfile(result, { walletAddress, isApproved: true });
    const now = Math.floor(Date.now() / 1000);
    const eleven = nextMondayAtUtcHour(8);
    await updateProviderAvailability(result.db, walletAddress, [eleven, eleven + 4 * 3600], now);

    await assert.rejects(
      () => setProviderBreaks(result.db, walletAddress, [{ weekday: MONDAY, startMinute: 10 * 60, endMinute: 11 * 60 + 30 }], now),
      InvalidBreaksError,
    );
    await assert.rejects(
      () => setProviderBreaks(result.db, walletAddress, [{ weekday: MONDAY, startMinute: 14 * 60, endMinute: 16 * 60 }], now),
      InvalidBreaksError,
    );
  } finally {
    closeDatabase(result);
  }
});

test("two breaks that overlap on the same weekday are rejected", async () => {
  const result = openTestDatabase();
  try {
    const walletAddress = "GBREAKSHOPWALLET3";
    await seedProviderProfile(result, { walletAddress, isApproved: true });
    const now = Math.floor(Date.now() / 1000);
    const eleven = nextMondayAtUtcHour(8);
    await updateProviderAvailability(result.db, walletAddress, [eleven, eleven + 4 * 3600], now);

    await assert.rejects(
      () =>
        setProviderBreaks(
          result.db,
          walletAddress,
          [
            { weekday: MONDAY, startMinute: 12 * 60, endMinute: 14 * 60 },
            { weekday: MONDAY, startMinute: 13 * 60, endMinute: 13 * 60 + 30 },
          ],
          now,
        ),
      InvalidBreaksError,
    );
  } finally {
    closeDatabase(result);
  }
});

test("a locked booking already inside the new break is listed and not cancelled", async () => {
  const result = openTestDatabase();
  try {
    const walletAddress = "GBREAKSHOPWALLET4";
    const providerProfileId = await seedProviderProfile(result, { walletAddress, isApproved: true });
    const now = Math.floor(Date.now() / 1000);
    const eleven = nextMondayAtUtcHour(8);
    const thirteenThirty = eleven + 2.5 * 3600;
    await replaceFutureSlots(result.db, providerProfileId, [eleven, thirteenThirty], now);

    // A locked booking on the slot the break will cover.
    const slot = await getSlotByProviderAndStart(result.db, providerProfileId, thirteenThirty);
    assert.ok(slot);
    const slotId = slot.id;
    const bookingId = "a".repeat(32);
    await insertBooking(result.db, {
      id: bookingId,
      providerProfileId,
      clientWalletAddress: "GBREAKCLIENT",
      tokenAddress: "CTOKENBREAK",
      depositAmount: "1000000",
      cancelDeadline: thirteenThirty - 3600,
      slotId,
      createdAt: Date.now(),
    });
    updateEscrowStateSync(result.db, bookingId, "locked");

    const saved = await setProviderBreaks(
      result.db,
      walletAddress,
      [{ weekday: MONDAY, startMinute: 13 * 60, endMinute: 14 * 60 }],
      now,
    );
    // The booked slot is still listed on the provider's own view...
    assert.ok(saved.slots.includes(thirteenThirty));
    // ...and the booking itself was never touched.
    const booking = await getBookingById(result.db, bookingId);
    assert.equal(booking?.escrowState, "locked");
    assert.equal(booking?.slotId, slotId);
  } finally {
    closeDatabase(result);
  }
});
