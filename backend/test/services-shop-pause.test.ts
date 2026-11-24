/**
 * Issue #62: the shop's own pause on new bookings. A paused shop refuses a
 * new hold while an existing booking still loads and works; an admin
 * suspension still hides the shop entirely. No network access --
 * `holdSlot`'s USDC resolution is injected.
 */
import "./testConfigEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";

import { BookingsPausedError, getBookingView, holdSlot } from "../src/services/booking.js";
import {
  ProviderNotFoundError,
  getOwnProviderProfile,
  getPublicProviderProfile,
  setProviderBookingsPaused,
} from "../src/services/profile.js";
import { replaceFutureSlots } from "../src/db/availabilitySlots.js";
import { setProviderProfileApproved } from "../src/db/providerProfiles.js";
import { closeDatabase, openTestDatabase, seedProviderProfile } from "./helpers.js";

const resolveUsdc = async () => ({ contractId: "CUSDCFAKECONTRACTID000000000000000000000000000000" });

test("a paused shop refuses a new hold and still loads an existing booking", async () => {
  const result = openTestDatabase();
  try {
    const walletAddress = "GPAUSESHOPWALLET";
    const providerProfileId = await seedProviderProfile(result, { walletAddress, isApproved: true });
    const now = Math.floor(Date.now() / 1000);
    const firstSlot = now + 3600;
    const secondSlot = now + 7200;
    await replaceFutureSlots(result.db, providerProfileId, [firstSlot, secondSlot], now);

    const first = await holdSlot(
      result.db,
      { providerProfileId, clientWalletAddress: "GPAUSECLIENT1", slotStartsAt: firstSlot },
      { now, resolveUsdcAsset: resolveUsdc },
    );

    // Pausing twice keeps the shop paused.
    const paused = await setProviderBookingsPaused(result.db, walletAddress, true, now);
    assert.equal(paused.bookingsPaused, true);
    const pausedAgain = await setProviderBookingsPaused(result.db, walletAddress, true, now);
    assert.equal(pausedAgain.bookingsPaused, true);

    // A new hold is refused...
    await assert.rejects(
      () =>
        holdSlot(
          result.db,
          { providerProfileId, clientWalletAddress: "GPAUSECLIENT2", slotStartsAt: secondSlot },
          { now, resolveUsdcAsset: resolveUsdc },
        ),
      BookingsPausedError,
    );

    // ...while the existing booking still loads, unchanged.
    const view = await getBookingView(result.db, first.bookingId, "GPAUSECLIENT1");
    assert.equal(view.id, first.bookingId);
    assert.equal(view.slotStartsAt, firstSlot);

    // Discovery's public view hides new slots and says the shop is paused.
    const publicView = await getPublicProviderProfile(result.db, providerProfileId, now);
    assert.equal(publicView.bookingsPaused, true);
    assert.deepEqual(publicView.slots, []);

    // Resuming reopens new holds.
    const resumed = await setProviderBookingsPaused(result.db, walletAddress, false, now);
    assert.equal(resumed.bookingsPaused, false);
    const second = await holdSlot(
      result.db,
      { providerProfileId, clientWalletAddress: "GPAUSECLIENT2", slotStartsAt: secondSlot },
      { now, resolveUsdcAsset: resolveUsdc },
    );
    assert.ok(second.bookingId);
    const ownAfterResume = await getOwnProviderProfile(result.db, walletAddress, now);
    assert.equal(ownAfterResume.bookingsPaused, false);
    assert.ok(ownAfterResume.slots.includes(secondSlot));
  } finally {
    closeDatabase(result);
  }
});

test("an admin suspension still hides a paused shop entirely", async () => {
  const result = openTestDatabase();
  try {
    const walletAddress = "GSUSPENDEDSHOPWALLET";
    const providerProfileId = await seedProviderProfile(result, { walletAddress, isApproved: true });
    await setProviderBookingsPaused(result.db, walletAddress, true);

    // Suspending is the admin's action, not the shop's pause -- and it still
    // makes the profile indistinguishable from an unknown one.
    await setProviderProfileApproved(result.db, providerProfileId, false);
    await assert.rejects(() => getPublicProviderProfile(result.db, providerProfileId), ProviderNotFoundError);
  } finally {
    closeDatabase(result);
  }
});
