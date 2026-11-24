/**
 * Issue #67: the shop's own bookings as a CSV file for a from/to range.
 *
 * Only the signed-in shop's bookings are ever read (the provider profile is
 * resolved from the caller's own wallet first), and only the six columns the
 * issue names are written -- never a client email or an intake answer,
 * because neither is selected.
 */
import { getProviderProfileByWallet } from "../db/providerProfiles.js";
import { listBookingRowsForProviderInRange, type BookingWithSlot } from "../db/bookings.js";
import { NotAProviderError } from "./profile.js";
import type { Db } from "../db/client.js";

const CSV_HEADER = ["booking_id", "start", "status", "deposit_amount", "currency", "contract_id"];

export class InvalidExportRangeError extends Error {
  constructor(message = "from and to must be integer epoch seconds, with from before to.") {
    super(message);
    this.name = "InvalidExportRangeError";
  }
}

export interface ExportRange {
  /** UTC epoch seconds, inclusive. */
  from: number;
  /** UTC epoch seconds, inclusive. */
  to: number;
}

const INTEGER_STRING = /^-?\d+$/;

/** Parses `?from=&to=`. Both are required integer epoch seconds; an
 * inverted range (or a non-integer) is the route's own `400`. */
export function parseExportRange(fromRaw: string | undefined, toRaw: string | undefined): ExportRange {
  if (!fromRaw || !toRaw || !INTEGER_STRING.test(fromRaw) || !INTEGER_STRING.test(toRaw)) {
    throw new InvalidExportRangeError();
  }
  const from = Number(fromRaw);
  const to = Number(toRaw);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) {
    throw new InvalidExportRangeError();
  }
  if (from > to) {
    throw new InvalidExportRangeError("from must be before (or equal to) to.");
  }
  return { from, to };
}

/** One CSV cell: quoted only when it contains a comma, a quote or a line
 * break, with inner quotes doubled (RFC 4180). This is what makes a comma
 * inside a value -- e.g. a shop name -- stay one field. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function bookingStatus(booking: BookingWithSlot["booking"], now: number): string {
  if (booking.escrowState !== null) {
    return booking.escrowState;
  }
  if (booking.holdExpiresAt !== null && booking.holdExpiresAt <= now) {
    return "expired";
  }
  return "held";
}

/** The file's own body: the six named columns, in that order, one row per
 * booking whose slot starts inside the range. */
export function buildProviderBookingsCsv(rows: BookingWithSlot[], now: number = Math.floor(Date.now() / 1000)): string {
  const lines = [CSV_HEADER.join(",")];
  for (const { booking, slotStartsAt } of rows) {
    const start = slotStartsAt === null ? "" : new Date(slotStartsAt * 1000).toISOString();
    lines.push(
      [
        csvField(booking.id),
        csvField(start),
        csvField(bookingStatus(booking, now)),
        csvField(booking.depositAmount),
        csvField("USDC"),
        csvField(booking.escrowContractId ?? ""),
      ].join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** A download filename that carries the shop's name but never a raw comma,
 * quote or path separator. */
export function exportFileName(shopName: string): string {
  const safe = shopName
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `pactly-${safe || "bookings"}-bookings.csv`;
}

export interface ProviderBookingsExport {
  csv: string;
  fileName: string;
}

/** `GET /me/provider/bookings/export`: the caller's own bookings in the
 * range. Another shop's bookings are never read -- the profile id comes
 * from the caller's own wallet. */
export async function exportProviderBookings(
  db: Db,
  walletAddress: string,
  range: ExportRange,
  now: number = Math.floor(Date.now() / 1000),
): Promise<ProviderBookingsExport> {
  const profile = await getProviderProfileByWallet(db, walletAddress);
  if (!profile) {
    throw new NotAProviderError();
  }
  const rows = await listBookingRowsForProviderInRange(db, profile.id, range.from, range.to);
  return { csv: buildProviderBookingsCsv(rows, now), fileName: exportFileName(profile.displayName) };
}
