const DAY_SECONDS = 24 * 60 * 60;

export function isWithinBookingWindow(
  startsAt: number,
  now: number,
  maxBookingDaysAhead?: number | null,
): boolean {
  if (maxBookingDaysAhead == null) return true;
  return startsAt <= now + maxBookingDaysAhead * DAY_SECONDS;
}
