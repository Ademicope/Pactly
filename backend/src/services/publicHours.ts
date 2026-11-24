const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export interface PublicDayHours {
  weekday: string;
  hours: string;
}

export function buildPublicHours(
  slotStarts: number[],
  sessionLengthMinutes: number,
  timeZone = "UTC",
): PublicDayHours[] {
  const byDay = new Map<string, { starts: string[]; ends: string[] }>();
  const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone });
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });

  for (const startsAt of slotStarts) {
    const start = new Date(startsAt * 1000);
    const weekday = weekdayFormatter.format(start);
    const group = byDay.get(weekday) ?? { starts: [], ends: [] };
    group.starts.push(timeFormatter.format(start));
    group.ends.push(timeFormatter.format(new Date((startsAt + sessionLengthMinutes * 60) * 1000)));
    byDay.set(weekday, group);
  }

  return WEEKDAYS.map((weekday) => {
    const group = byDay.get(weekday);
    if (!group) return { weekday, hours: "Closed" };
    group.starts.sort();
    group.ends.sort();
    return { weekday, hours: `${group.starts[0]}–${group.ends.at(-1)}` };
  });
}
