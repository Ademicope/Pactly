/**
 * Issue #64: rendering a stored instant in the *shop's* own IANA timezone.
 *
 * A slot is UTC epoch seconds end to end (the backend's own "Always" rule);
 * the timezone only ever changes its *label*. Nothing here converts or
 * rewrites the stored instant, and no lock or hold reads a label -- a lock
 * still uses the same server instant.
 *
 * Pure functions over `Intl.DateTimeFormat`, so they are testable without a
 * browser and behave identically wherever the process itself runs (a
 * client whose browser is in another zone still sees the shop's zone).
 */

/** The default a shop starts with -- the zone the demo's own hours grid
 * has always been built in. A shop can change it to any IANA zone. */
export const DEFAULT_PROVIDER_TIMEZONE = "Europe/Istanbul";

/** `true` only for an IANA zone `Intl` actually knows. An empty string, an
 * abbreviation like `"PST"` and a fictional zone are all rejected. */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== "string" || timeZone.trim() === "") {
    return false;
  }
  try {
    // Constructing the formatter is the check: an unknown zone throws a
    // RangeError, a known one never does.
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface SlotLabel {
  /** Short weekday in the shop's zone, e.g. `"Mon"`. */
  weekday: string;
  /** 24-hour wall-clock time in the shop's zone, e.g. `"15:00"`. */
  time: string;
  /** The IANA zone the label was rendered in, e.g. `"Europe/Istanbul"`. */
  timeZone: string;
  /** `"Mon 15:00 (Europe/Istanbul)"` -- weekday, time and zone name together. */
  label: string;
}

const WEEKDAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: "short" };
const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };

/** Renders one stored instant (UTC epoch seconds) as the shop's own weekday,
 * time and timezone name. The IANA name is always included explicitly, so
 * the label never depends on a runtime's localized `timeZoneName` wording
 * (`GMT+3`, `Türkiye Standard Time`, ...). */
export function formatSlotInTimeZone(startsAt: number, timeZone: string): SlotLabel {
  const date = new Date(startsAt * 1000);
  const weekday = new Intl.DateTimeFormat("en-US", { ...WEEKDAY_FORMAT, timeZone }).format(date);
  // `en-GB` with `hour12: false` is the stable `HH:mm` shape; `en-US` would
  // render `03:00 PM`.
  const time = new Intl.DateTimeFormat("en-GB", { ...TIME_FORMAT, timeZone }).format(date);
  return { weekday, time, timeZone, label: `${weekday} ${time} (${timeZone})` };
}
