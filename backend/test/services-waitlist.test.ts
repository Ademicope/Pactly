/**
 * `services/waitlist.ts` unit tests -- no network access.
 */
import "./testConfigEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { Keypair } from "@stellar/stellar-sdk";

import {
  InvalidWaitlistDateError,
  InvalidWaitlistNoteError,
  ProviderNotFoundError,
  WaitlistEntryExistsError,
  WaitlistSlotsAvailableError,
  joinWaitlist,
  listWaitlistForDate,
  listClientWaitlist,
} from "../src/services/waitlist.js";
import { waitlistEntries, availabilitySlots } from "../src/db/schema.js";
import { closeDatabase, openTestDatabase, seedProviderProfile } from "./helpers.js";

test("joinWaitlist adds a client to the waitlist for a date with no open slots", async () => {
  const result = openTestDatabase();
  try {
    const providerProfileId = await seedProviderProfile(result, { isApproved: true });
    const now = Math.floor(Date.now() / 1000);
    const date = "2026-12-25";
    const clientWallet = Keypair.random().publicKey();

    const entry = await joinWaitlist(
      result.db,
      { providerProfileId, clientWalletAddress: clientWallet, date, note: "Please notify me" },
      { now },
    );

    assert.equal(entry.providerProfileId, providerProfileId);
    assert.equal(entry.clientWalletAddress, clientWallet);
    assert.equal(entry.date, date);
    assert.equal(entry.note, "Please notify me");

    const rows = await result.db.select().from(waitlistEntries).where(eq(waitlistEntries.id, entry.id)).limit(1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.clientWalletAddress, clientWallet);
  } finally {
    closeDatabase(result);
  }
});

test("joinWaitlist rejects when the provider does not exist", async () => {
  const result = openTestDatabase();
  try {
    const now = Math.floor(Date.now() / 1000);
    const date = "2026-12-25";
    const clientWallet = Keypair.random().publicKey();

    await assert.rejects(
      () => joinWaitlist(result.db, { providerProfileId: "nonexistent", clientWalletAddress: clientWallet, date }, { now }),
      ProviderNotFoundError,
    );
  } finally {
    closeDatabase(result);
  }
});

test("joinWaitlist rejects an invalid date format", async () => {
  const result = openTestDatabase();
  try {
    const providerProfileId = await seedProviderProfile(result, { isApproved: true });
    const now = Math.floor(Date.now() / 1000);
    const clientWallet = Keypair.random().publicKey();

    await assert.rejects(
      () => joinWaitlist(result.db, { providerProfileId, clientWalletAddress: clientWallet, date: "invalid-date" }, { now }),
      InvalidWaitlistDateError,
    );

    await assert.rejects(
      () => joinWaitlist(result.db, { providerProfileId, clientWalletAddress: clientWallet, date: "2026-13-01" }, { now }),
      InvalidWaitlistDateError,
    );
  } finally {
    closeDatabase(result);
  }
});

test("joinWaitlist rejects when the date has open slots", async () => {
  const result = openTestDatabase();
  try {
    const providerProfileId = await seedProviderProfile(result, { isApproved: true, sessionLengthMinutes: 60 });
    const now = Math.floor(Date.now() / 1000);
    const slotStartsAt = now + 86400; // tomorrow
    const date = new Date(slotStartsAt * 1000).toISOString().slice(0, 10);
    const clientWallet = Keypair.random().publicKey();

    await result.db.insert(availabilitySlots).values({
      id: "slot-1",
      providerProfileId,
      startsAt: slotStartsAt,
      createdAt: Date.now(),
    });

    await assert.rejects(
      () => joinWaitlist(result.db, { providerProfileId, clientWalletAddress: clientWallet, date }, { now }),
      WaitlistSlotsAvailableError,
    );
  } finally {
    closeDatabase(result);
  }
});

test("joinWaitlist rejects a duplicate entry for the same client/shop/date", async () => {
  const result = openTestDatabase();
  try {
    const providerProfileId = await seedProviderProfile(result, { isApproved: true });
    const now = Math.floor(Date.now() / 1000);
    const date = "2026-12-25";
    const clientWallet = Keypair.random().publicKey();

    const first = await joinWaitlist(
      result.db,
      { providerProfileId, clientWalletAddress: clientWallet, date },
      { now },
    );

    await assert.rejects(
      () => joinWaitlist(result.db, { providerProfileId, clientWalletAddress: clientWallet, date }, { now }),
      (error: unknown) => error instanceof WaitlistEntryExistsError && error.waitlistEntryId === first.id,
    );
  } finally {
    closeDatabase(result);
  }
});

test("joinWaitlist caps note at 300 characters", async () => {
  const result = openTestDatabase();
  try {
    const providerProfileId = await seedProviderProfile(result, { isApproved: true });
    const now = Math.floor(Date.now() / 1000);
    const date = "2026-12-25";
    const clientWallet = Keypair.random().publicKey();
    const longNote = "a".repeat(301);

    await assert.rejects(
      () => joinWaitlist(result.db, { providerProfileId, clientWalletAddress: clientWallet, date, note: longNote }, { now }),
      InvalidWaitlistNoteError,
    );

    // Exactly 300 characters should be allowed
    const okNote = "b".repeat(300);
    const entry = await joinWaitlist(
      result.db,
      { providerProfileId, clientWalletAddress: clientWallet, date, note: okNote },
      { now },
    );
    assert.equal(entry.note, okNote);
  } finally {
    closeDatabase(result);
  }
});

test("listWaitlistForDate returns waitlist entries for a provider's date", async () => {
  const result = openTestDatabase();
  try {
    const providerProfileId = await seedProviderProfile(result, { isApproved: true });
    const now = Math.floor(Date.now() / 1000);
    const date = "2026-12-25";
    const client1 = Keypair.random().publicKey();
    const client2 = Keypair.random().publicKey();

    await joinWaitlist(result.db, { providerProfileId, clientWalletAddress: client1, date, note: "First" }, { now: now - 100 });
    await joinWaitlist(result.db, { providerProfileId, clientWalletAddress: client2, date, note: "Second" }, { now });

    const entries = await listWaitlistForDate(result.db, providerProfileId, date);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.clientWalletAddress, client1);
    assert.equal(entries[0]!.note, "First");
    assert.equal(entries[1]!.clientWalletAddress, client2);
    assert.equal(entries[1]!.note, "Second");
  } finally {
    closeDatabase(result);
  }
});

test("listClientWaitlist returns a client's waitlist entries across all providers", async () => {
  const result = openTestDatabase();
  try {
    const provider1 = await seedProviderProfile(result, { isApproved: true, displayName: "Provider One" });
    const provider2 = await seedProviderProfile(result, { isApproved: true, displayName: "Provider Two" });
    const now = Math.floor(Date.now() / 1000);
    const client = Keypair.random().publicKey();

    await joinWaitlist(result.db, { providerProfileId: provider1, clientWalletAddress: client, date: "2026-12-25", note: "For provider 1" }, { now: now - 100 });
    await joinWaitlist(result.db, { providerProfileId: provider2, clientWalletAddress: client, date: "2026-12-26", note: "For provider 2" }, { now });

    const entries = await listClientWaitlist(result.db, client);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.providerProfileId, provider1);
    assert.equal(entries[0]!.providerDisplayName, "Provider One");
    assert.equal(entries[0]!.note, "For provider 1");
    assert.equal(entries[1]!.providerProfileId, provider2);
    assert.equal(entries[1]!.providerDisplayName, "Provider Two");
    assert.equal(entries[1]!.note, "For provider 2");
  } finally {
    closeDatabase(result);
  }
});