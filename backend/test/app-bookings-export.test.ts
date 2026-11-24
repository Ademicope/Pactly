/**
 * Issue #67: the signed-in shop downloads a CSV of its own bookings for a
 * from/to range. Another shop's booking is never in the file, client emails
 * and intake answers are absent, an inverted range is a 400, and a comma in
 * the shop name is escaped/kept out of the filename.
 */
import "./testConfigEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/app.js";
import { issuePactlyJwt } from "../src/auth/challenge.js";
import { insertBooking } from "../src/db/bookings.js";
import { getSlotByProviderAndStart, replaceFutureSlots } from "../src/db/availabilitySlots.js";
import { csvField, exportFileName, exportProviderBookings } from "../src/services/bookingsExport.js";
import { closeDatabase, openTestDatabase, seedProviderProfile } from "./helpers.js";

async function seedBookingAtSlot(
  result: ReturnType<typeof openTestDatabase>,
  providerProfileId: string,
  startsAt: number,
  bookingId: string,
  clientWalletAddress: string,
): Promise<void> {
  await replaceFutureSlots(result.db, providerProfileId, [startsAt], 0);
  const slot = await getSlotByProviderAndStart(result.db, providerProfileId, startsAt);
  assert.ok(slot);
  await insertBooking(result.db, {
    id: bookingId,
    providerProfileId,
    clientWalletAddress,
    tokenAddress: "CTOKENEXPORT",
    depositAmount: "2000000",
    cancelDeadline: startsAt - 3600,
    slotId: slot.id,
    createdAt: Date.now(),
  });
}

test("exports two bookings and never another shop's row", async () => {
  const result = openTestDatabase();
  try {
    const shopWallet = "GEXPORTSHOPWALLET";
    const otherShopWallet = "GEXPORTOTHERSHOP";
    const shopId = await seedProviderProfile(result, {
      walletAddress: shopWallet,
      isApproved: true,
      displayName: "Aydın, Elif",
    });
    const otherShopId = await seedProviderProfile(result, {
      walletAddress: otherShopWallet,
      isApproved: true,
      displayName: "Other Shop",
    });

    await seedBookingAtSlot(result, shopId, 1200, "a".repeat(32), "GEXPORTCLIENT1");
    await seedBookingAtSlot(result, shopId, 1500, "b".repeat(32), "GEXPORTCLIENT2");
    await seedBookingAtSlot(result, otherShopId, 1300, "c".repeat(32), "GEXPORTCLIENT3");

    const { csv, fileName } = await exportProviderBookings(result.db, shopWallet, { from: 1000, to: 2000 });

    const lines = csv.trim().split("\r\n");
    assert.equal(lines[0], "booking_id,start,status,deposit_amount,currency,contract_id");
    assert.equal(lines.length, 3);
    assert.ok(lines[1]!.startsWith(`${"a".repeat(32)},`));
    assert.ok(lines[2]!.startsWith(`${"b".repeat(32)},`));
    assert.ok(!csv.includes("c".repeat(32)));
    // No client email/intake columns or values at all.
    assert.ok(!csv.includes("GEXPORTCLIENT1"));
    assert.ok(!csv.includes("@"));
    assert.ok(lines[1]!.includes("2000000,USDC,"));

    // The shop's name never puts a raw comma (or path separator) in the file
    // name.
    assert.ok(fileName.endsWith("-bookings.csv"));
    assert.ok(!fileName.includes(","));
    assert.equal(csvField("Aydın, Elif"), '"Aydın, Elif"');
    assert.equal(csvField('He said "hi"'), '"He said ""hi"""');
    assert.equal(exportFileName("Aydın, Elif"), "pactly-Ayd-n-Elif-bookings.csv");
  } finally {
    closeDatabase(result);
  }
});

test("GET /me/provider/bookings/export is CSV, and an inverted range is a 400", async () => {
  const result = openTestDatabase();
  try {
    const walletAddress = "GEXPORTROUTEWALLET";
    const providerProfileId = await seedProviderProfile(result, { walletAddress, isApproved: true });
    await seedBookingAtSlot(result, providerProfileId, 1200, "d".repeat(32), "GEXPORTCLIENT4");
    const app = createApp(result.db);
    const token = await issuePactlyJwt(walletAddress);
    const headers = { authorization: `Bearer ${token}` };

    const ok = await app.request("/me/provider/bookings/export?from=1000&to=2000", { headers });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-type") ?? "", /^text\/csv/);
    assert.match(ok.headers.get("content-disposition") ?? "", /attachment; filename="pactly-.*-bookings\.csv"/);
    const body = await ok.text();
    assert.equal(body.trim().split("\r\n").length, 2);

    const inverted = await app.request("/me/provider/bookings/export?from=2000&to=1000", { headers });
    assert.equal(inverted.status, 400);
    const envelope = (await inverted.json()) as { code: string };
    assert.equal(envelope.code, "INVALID_RANGE");

    const missing = await app.request("/me/provider/bookings/export?from=1000", { headers });
    assert.equal(missing.status, 400);
  } finally {
    closeDatabase(result);
  }
});
