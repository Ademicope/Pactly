/**
 * Timezone helpers shared by the slot-label feature (issue #64) and the
 * weekday-break feature (issue #65).
 *
 * A slot is UTC epoch seconds end to end; a timezone only ever changes its
 * *label*, never the stored instant. Breaks are named in the shop's own
 * wall clock, so a stored instant is read back as that zone's weekday and
 * minute of day. Pure `Intl` functions, so they are testable without a
 * browser and behave identically wherever the process runs.
 */

/** The default a shop starts with -- the zone the demo's own hours grid
 * has always been built in. A shop can change it to any IANA zone. */
export const DEFAULT_PROVIDER_TIMEZONE = "Europe/Istanbul";

/** `true` only for an IANA zone `Intl` actually knows. */
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
 * time and timezone name. */
export function formatSlotInTimeZone(startsAt: number, timeZone: string): SlotLabel {
  const date = new Date(startsAt * 1000);
  const weekday = new Intl.DateTimeFormat("en-US", { ...WEEKDAY_FORMAT, timeZone }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", { ...TIME_FORMAT, timeZone }).format(date);
  return { weekday, time, timeZone, label: `${weekday} ${time} (${timeZone})` };
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface ZonedClock {
  /** `0` = Sunday .. `6` = Saturday, in the shop's zone. */
  weekday: number;
  /** Minutes since midnight, in the shop's zone (0..1439). */
  minuteOfDay: number;
}

/** Reads one stored instant (UTC epoch seconds) as the shop's own weekday
 * and minute of day. `hourCycle: "h23"` keeps midnight `00`, never `24`. */
export function zonedClock(startsAt: number, timeZone: string): ZonedClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(startsAt * 1000));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = WEEKDAY_NAMES.indexOf(value("weekday"));
  if (weekday === -1) {
    throw new TypeError(`Could not read a weekday in timezone "${timeZone}"`);
  }
  return { weekday, minuteOfDay: Number(value("hour")) * 60 + Number(value("minute")) };
}
