import { formatSlotDayShort, formatSlotTime, formatSlotWithZone } from "../lib/time";

export interface SlotChipProps {
  startsAt: number;
  selected?: boolean;
  onSelect?: (startsAt: number) => void;
  /** Discover v2's own card slots carry a short day prefix ("Today
   * 17:30", "Sat 11:00") because they sit under no day heading, so the
   * same hour on two different days doesn't read as the same slot twice.
   * Callers that already group slots under a day heading (the provider
   * profile) or that only ever show one day's own slots (a same-day
   * fallback list) leave this unset and keep the plain time. */
  showDay?: boolean;
  /** Issue #64: the shop's IANA zone. When supplied, the chip names the
   * shop's weekday, time and timezone instead of the viewer's local time. */
  timeZone?: string;
}

/** DESIGN.md's `chip-slot`, keyboard-reachable (a real `<button>`, not a
 * `<div>` with a click handler), at least 44px per the Accessibility
 * Floor. This story only ever renders open slots -- nothing here is
 * "taken" yet (no booking exists that could hold one). */
export function SlotChip({ startsAt, selected, onSelect, showDay, timeZone }: SlotChipProps) {
  return (
    <button
      type="button"
      className={`slot-chip tabular-nums${selected ? " slot-chip--selected" : ""}`}
      aria-pressed={selected ?? false}
      onClick={() => onSelect?.(startsAt)}
    >
      {timeZone
        ? formatSlotWithZone(startsAt, timeZone)
        : showDay
          ? `${formatSlotDayShort(startsAt)} ${formatSlotTime(startsAt)}`
          : formatSlotTime(startsAt)}
    </button>
  );
}
