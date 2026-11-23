/**
 * Waitlist service: allows clients to join a waitlist for a shop's date
 * when no open slots are available. One entry per client per shop per date.
 * Does not hold a slot or take a deposit.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { providerProfiles, waitlistEntries } from "../db/schema.js";
import { getProviderProfileById } from "../db/providerProfiles.js";
import { listOfferedSlotsInRange } from "./availability.js";
import { utcDateFor } from "../db/closedDates.js";

export class ProviderNotFoundError extends Error {
  constructor(message = "No provider was found with that id.") {
    super(message);
    this.name = "ProviderNotFoundError";
  }
}

export class WaitlistEntryExistsError extends Error {
  readonly waitlistEntryId: string;
  constructor(waitlistEntryId: string) {
    super("You're already on the waitlist for this date.");
    this.name = "WaitlistEntryExistsError";
    this.waitlistEntryId = waitlistEntryId;
  }
}

export class WaitlistSlotsAvailableError extends Error {
  constructor(message = "This date has open slots. Please book one instead of joining the waitlist.") {
    super(message);
    this.name = "WaitlistSlotsAvailableError";
  }
}

export class InvalidWaitlistDateError extends Error {
  readonly details: Record<string, string>;
  constructor(date: unknown) {
    super("Use a calendar date in YYYY-MM-DD form.");
    this.name = "InvalidWaitlistDateError";
    this.details = { date: `Invalid date "${String(date)}": use YYYY-MM-DD.` };
  }
}

export class InvalidWaitlistNoteError extends Error {
  constructor(message = "Note must be 300 characters or less.") {
    super(message);
    this.name = "InvalidWaitlistNoteError";
  }
}

export interface WaitlistEntry {
  id: string;
  providerProfileId: string;
  clientWalletAddress: string;
  date: string;
  note: string | null;
  createdAt: number;
}

export interface JoinWaitlistInput {
  providerProfileId: string;
  clientWalletAddress: string;
  date: string;
  note?: string | null;
}

export interface JoinWaitlistDeps {
  now?: number;
}

/** Validates a date string as YYYY-MM-DD. */
function isValidWaitlistDate(date: unknown): date is string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** Checks if a shop has any open slots on the given date. */
async function hasOpenSlotsOnDate(db: Db, providerProfileId: string, date: string, now: number): Promise<boolean> {
  const profile = await getProviderProfileById(db, providerProfileId);
  if (!profile) {
    return false;
  }
  const dayStart = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
  const dayEnd = dayStart + 24 * 60 * 60;
  const openSlots = await listOfferedSlotsInRange(
    db,
    providerProfileId,
    dayStart,
    dayEnd,
    profile.sessionLengthMinutes,
    profile.bufferMinutes,
    now,
  );
  return openSlots.length > 0;
}

/**
 * Adds a client to the waitlist for a shop's date.
 * - Validates the provider exists.
 * - Checks the date is valid YYYY-MM-DD.
 * - Rejects if the date already has open slots (client should book instead).
 * - Rejects if the client already has a waitlist entry for this shop/date (idempotent).
 * - Caps note at 300 characters.
 * - Does not hold a slot or take a deposit.
 */
export async function joinWaitlist(db: Db, input: JoinWaitlistInput, deps: JoinWaitlistDeps = {}): Promise<WaitlistEntry> {
  const now = deps.now ?? Math.floor(Date.now() / 1000);

  if (!isValidWaitlistDate(input.date)) {
    throw new InvalidWaitlistDateError(input.date);
  }

  const profile = await getProviderProfileById(db, input.providerProfileId);
  if (!profile) {
    throw new ProviderNotFoundError();
  }

  // If there are open slots, the client should book instead of waitlisting.
  if (await hasOpenSlotsOnDate(db, input.providerProfileId, input.date, now)) {
    throw new WaitlistSlotsAvailableError();
  }

  // Check for existing waitlist entry (idempotent).
  const existing = await db
    .select()
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.providerProfileId, input.providerProfileId),
        eq(waitlistEntries.clientWalletAddress, input.clientWalletAddress),
        eq(waitlistEntries.date, input.date),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    throw new WaitlistEntryExistsError(existing[0]!.id);
  }

  const note = input.note?.trim();
  if (note !== undefined && note.length > 300) {
    throw new InvalidWaitlistNoteError();
  }

  const id = randomUUID();
  await db.insert(waitlistEntries).values({
    id,
    providerProfileId: input.providerProfileId,
    clientWalletAddress: input.clientWalletAddress,
    date: input.date,
    note: note ?? null,
    createdAt: now,
  });

  return { id, providerProfileId: input.providerProfileId, clientWalletAddress: input.clientWalletAddress, date: input.date, note: note ?? null, createdAt: now };
}

/** Lists all waitlist entries for a provider's date (shop view). */
export async function listWaitlistForDate(db: Db, providerProfileId: string, date: string): Promise<WaitlistEntry[]> {
  const rows = await db
    .select()
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.providerProfileId, providerProfileId), eq(waitlistEntries.date, date)))
    .orderBy(waitlistEntries.createdAt);
  return rows.map((row) => ({ ...row, note: row.note ?? null }));
}

/** Lists a client's own waitlist entries across all providers. */
export async function listClientWaitlist(db: Db, clientWalletAddress: string): Promise<(WaitlistEntry & { providerDisplayName: string })[]> {
  const rows = await db
    .select({
      waitlist: waitlistEntries,
      providerDisplayName: providerProfiles.displayName,
    })
    .from(waitlistEntries)
    .innerJoin(providerProfiles, eq(waitlistEntries.providerProfileId, providerProfiles.id))
    .where(eq(waitlistEntries.clientWalletAddress, clientWalletAddress))
    .orderBy(waitlistEntries.createdAt);
  return rows.map((row) => ({ ...row.waitlist, note: row.waitlist.note ?? null, providerDisplayName: row.providerDisplayName }));
}