/** The only place SQL touches `provider_breaks` (issue #65). A break is a
 * recurring weekly window in the shop's own wall clock, not a concrete
 * instant -- `services/availability.ts` validates and applies it, and
 * `services/profile.ts` owns the save that also prunes clashing slots. */
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";

import type { Db } from "./client.js";
import { providerBreaks } from "./schema.js";
import type { ProviderBreak } from "../services/availability.js";

export type ProviderBreakRow = typeof providerBreaks.$inferSelect;

export async function listProviderBreaks(db: Db, providerProfileId: string): Promise<ProviderBreak[]> {
  const rows = await db
    .select()
    .from(providerBreaks)
    .where(eq(providerBreaks.providerProfileId, providerProfileId))
    .orderBy(asc(providerBreaks.weekday), asc(providerBreaks.startMinute));
  return rows.map((row) => ({ weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute }));
}

/** Replaces every break for one provider in one transaction. Synchronous
 * inside the `db.transaction()` callback, per better-sqlite3's contract
 * (same shape as `replaceFutureSlots`). */
export async function replaceProviderBreaks(
  db: Db,
  providerProfileId: string,
  breaks: ProviderBreak[],
): Promise<void> {
  const createdAt = Date.now();
  db.transaction((tx) => {
    tx.delete(providerBreaks).where(eq(providerBreaks.providerProfileId, providerProfileId)).run();
    for (const providerBreak of breaks) {
      tx.insert(providerBreaks)
        .values({
          id: randomUUID(),
          providerProfileId,
          weekday: providerBreak.weekday,
          startMinute: providerBreak.startMinute,
          endMinute: providerBreak.endMinute,
          createdAt,
        })
        .run();
    }
  });
}
