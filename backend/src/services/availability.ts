/**
 * Availability services: one-off closures as an overlay on a provider's
 * repeating slot pattern, and the appointment buffer that keeps a gap after
 * a locked booking.
 *
 * A single day off must not mean deleting that day's slots and rebuilding
 * them next week, so a closure hides a *calendar date*; the slot rows stay
 * exactly where they are and reopening the date reveals them again. Nothing
 * here touches bookings: a date holding a locked booking is refused outright
 * (with the booking's id, so the panel can name it) rather than silently
 * cancelling anyone's appointment.
 *
 * After a locked booking ends, `bufferMinutes` stay free before another
 * slot of the same shop is offered. Weekly hours and existing locked
 * bookings are never rewritten here -- this module only filters what clients
 * are shown (and what `holdSlot` may claim).
 */
import { and, eq } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { availabilitySlots, bookings } from "../db/schema.js";
import {
  listEarliestFutureSlotsByProvider,
  listOpenFutureSlots,
  listOpenSlotsInRange,
  type ListFutureSlotsOptions,
} from "../db/availabilitySlots.js";
import {
  isValidClosedDate,
  insertClosedDate,
  deleteClosedDate,
  isDateClosed,
  listClosedDates,
  listLockedBookingsOnDate,
} from "../db/closedDates.js";
import { getProviderProfileByWallet } from "../db/providerProfiles.js";
import { NotAProviderError } from "./profile.js";

export { NotAProviderError };

export class InvalidClosedDateError extends Error {
  readonly details: Record<string, string>;
  constructor(date: unknown) {
    super("Use a calendar date in YYYY-MM-DD form.");
    this.name = "InvalidClosedDateError";
    this.details = { date: `Invalid date "${String(date)}": use YYYY-MM-DD.` };
  }
}

export class ClosedDateBookingError extends Error {
  /** The booking the panel names in its error message. */
  readonly bookingId: string;
  readonly slotStartsAt: number;
  readonly escrowState: string;
  constructor(booking: { bookingId: string; slotStartsAt: number; escrowState: string }) {
    super(`This date has a locked booking (${booking.bookingId}). It can't be closed.`);
    this.name = "ClosedDateBookingError";
    this.bookingId = booking.bookingId;
    this.slotStartsAt = booking.slotStartsAt;
    this.escrowState = booking.escrowState;
  }
}

async function ownProviderId(db: Db, walletAddress: string): Promise<string> {
  const profile = await getProviderProfileByWallet(db, walletAddress);
  if (!profile) {
    throw new NotAProviderError();
  }
  return profile.id;
}

/**
 * Closes one UTC calendar date for the caller's own shop. Duplicate closes
 * are a no-op (the insert is `ON CONFLICT DO NOTHING`). Returns the full,
 * sorted list of the shop's closed dates, including this one.
 */
export async function closeDate(
  db: Db,
  walletAddress: string,
  date: unknown,
  now: number = Date.now(),
): Promise<string[]> {
  if (!isValidClosedDate(date)) {
    throw new InvalidClosedDateError(date);
  }
  const providerProfileId = await ownProviderId(db, walletAddress);
  // A retry of an already-closed date changes nothing at all -- not even an
  // error about a booking that locked after the closure was first made.
  if (await isDateClosed(db, providerProfileId, date)) {
    return listClosedDates(db, providerProfileId);
  }
  const locked = await listLockedBookingsOnDate(db, providerProfileId, date);
  if (locked.length > 0) {
    // Name a concrete booking so the panel can point at it -- closing the
    // date would be a destructive act against a real appointment.
    throw new ClosedDateBookingError(locked[0]!);
  }
  await insertClosedDate(db, providerProfileId, date, now);
  return listClosedDates(db, providerProfileId);
}

/** Alias named for the shop-facing wording. */
export const closeProviderDate = closeDate;
export const closeAvailabilityDate = closeDate;

/** Removes a closure. Removing a date that was never closed is a no-op. */
export async function reopenDate(db: Db, walletAddress: string, date: unknown): Promise<string[]> {
  if (!isValidClosedDate(date)) {
    throw new InvalidClosedDateError(date);
  }
  const providerProfileId = await ownProviderId(db, walletAddress);
  await deleteClosedDate(db, providerProfileId, date);
  return listClosedDates(db, providerProfileId);
}

export const reopenProviderDate = reopenDate;
export const openDate = reopenDate;
/** Panel wording: a closed date is a blocked date, not a deleted slot. */
export const blockDate = closeDate;
export const unblockDate = reopenDate;
export const setDateClosed = closeDate;

/** Every closed UTC date for the caller's shop, ascending. */
export async function listClosedDatesForWallet(db: Db, walletAddress: string): Promise<string[]> {
  const providerProfileId = await ownProviderId(db, walletAddress);
  return listClosedDates(db, providerProfileId);
}

/** True when `slotStartsAt` falls in the half-open window
 * `[sessionEnd, sessionEnd + buffer)` after a locked booking that started
 * at `lockedStartsAt`. A buffer of zero never blocks (adjacent stays). */
export function isSlotInsideBufferAfterLocked(
  slotStartsAt: number,
  lockedStartsAt: number,
  sessionLengthMinutes: number,
  bufferMinutes: number,
): boolean {
  if (bufferMinutes <= 0) {
    return false;
  }
  const sessionEnd = lockedStartsAt + sessionLengthMinutes * 60;
  const bufferEnd = sessionEnd + bufferMinutes * 60;
  return slotStartsAt >= sessionEnd && slotStartsAt < bufferEnd;
}

/** Drops every start time that sits inside the post-session buffer of any
 * locked booking. Locked starts from other shops are never passed in --
 * callers scope them to one provider. */
export function filterSlotsOutsideAppointmentBuffer(
  slotStarts: readonly number[],
  lockedStarts: readonly number[],
  sessionLengthMinutes: number,
  bufferMinutes: number,
): number[] {
  if (bufferMinutes <= 0 || lockedStarts.length === 0) {
    return [...slotStarts];
  }
  return slotStarts.filter(
    (slotStartsAt) =>
      !lockedStarts.some((lockedStartsAt) =>
        isSlotInsideBufferAfterLocked(slotStartsAt, lockedStartsAt, sessionLengthMinutes, bufferMinutes),
      ),
  );
}

/** UTC epoch seconds for every slot this shop currently has in `locked`
 * escrow -- the only bookings the buffer cares about (holds do not count). */
export async function listLockedBookingStarts(db: Db, providerProfileId: string): Promise<number[]> {
  const rows = await db
    .select({ startsAt: availabilitySlots.startsAt })
    .from(bookings)
    .innerJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .where(and(eq(bookings.providerProfileId, providerProfileId), eq(bookings.escrowState, "locked")));
  return rows.map((row) => row.startsAt);
}

export interface OfferedSlotsOptions extends ListFutureSlotsOptions {
  sessionLengthMinutes: number;
  bufferMinutes: number;
}

/** Open future slots for one shop, minus any start that lands inside the
 * buffer after a locked booking on that same shop. */
export async function listOfferedSlots(db: Db, providerProfileId: string, options: OfferedSlotsOptions): Promise<number[]> {
  const open = await listOpenFutureSlots(db, providerProfileId, {
    now: options.now,
    withinSeconds: options.withinSeconds,
  });
  if (options.bufferMinutes <= 0) {
    return open.map((slot) => slot.startsAt);
  }
  const lockedStarts = await listLockedBookingStarts(db, providerProfileId);
  return filterSlotsOutsideAppointmentBuffer(
    open.map((slot) => slot.startsAt),
    lockedStarts,
    options.sessionLengthMinutes,
    options.bufferMinutes,
  );
}

/** Same-day open slots for `SLOT_TAKEN`, with the appointment buffer applied. */
export async function listOfferedSlotsInRange(
  db: Db,
  providerProfileId: string,
  rangeStart: number,
  rangeEnd: number,
  sessionLengthMinutes: number,
  bufferMinutes: number,
  now: number = Math.floor(Date.now() / 1000),
): Promise<number[]> {
  const open = await listOpenSlotsInRange(db, providerProfileId, rangeStart, rangeEnd, now);
  if (bufferMinutes <= 0) {
    return open;
  }
  const lockedStarts = await listLockedBookingStarts(db, providerProfileId);
  return filterSlotsOutsideAppointmentBuffer(open, lockedStarts, sessionLengthMinutes, bufferMinutes);
}

export interface ProviderBufferProfile {
  id: string;
  sessionLengthMinutes: number;
  bufferMinutes: number;
}

/** Earliest offered starts per provider (Discover cards), buffer-aware.
 * Providers with buffer 0 reuse the batch open-slot query; others re-list
 * and filter so a buffered gap never consumes a card's three-slot budget. */
export async function listEarliestOfferedSlotsByProvider(
  db: Db,
  profiles: readonly ProviderBufferProfile[],
  now: number,
  limit: number,
): Promise<Map<string, number[]>> {
  const result = await listEarliestFutureSlotsByProvider(
    db,
    profiles.map((profile) => profile.id),
    { now, limit },
  );

  for (const profile of profiles) {
    if (profile.bufferMinutes <= 0) {
      continue;
    }
    const offered = await listOfferedSlots(db, profile.id, {
      now,
      sessionLengthMinutes: profile.sessionLengthMinutes,
      bufferMinutes: profile.bufferMinutes,
    });
    result.set(profile.id, offered.slice(0, limit));
  }

  return result;
}
