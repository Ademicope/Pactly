/**
 * Database functions for saved shops (#73).
 */
import { eq, and, desc } from "drizzle-orm";
import type { Db } from "./client.js";
import { savedShops, providerProfiles } from "./schema.js";

export interface SavedShopRow {
  id: string;
  clientWalletAddress: string;
  providerProfileId: string;
  createdAt: number;
}

export interface SavedShopInput {
  id: string;
  clientWalletAddress: string;
  providerProfileId: string;
  createdAt: number;
}

/**
 * Saves a shop for a client. Idempotent - saving twice is a no-op (returns
 * the existing row).
 */
export async function saveShopForClient(db: Db, input: SavedShopInput): Promise<SavedShopRow> {
  // Check if already saved
  const existing = await db
    .select()
    .from(savedShops)
    .where(
      and(
        eq(savedShops.clientWalletAddress, input.clientWalletAddress),
        eq(savedShops.providerProfileId, input.providerProfileId),
      ),
    )
    .get();

  if (existing) {
    return existing;
  }

  // Insert new saved shop
  await db.insert(savedShops).values(input).run();

  const saved = await db.select().from(savedShops).where(eq(savedShops.id, input.id)).get();
  if (!saved) {
    throw new Error("Failed to save shop");
  }
  return saved;
}

/**
 * Unsaves a shop for a client. Returns true if a row was deleted, false if it
 * wasn't saved.
 */
export async function unsaveShopForClient(
  db: Db,
  clientWalletAddress: string,
  providerProfileId: string,
): Promise<boolean> {
  const result = await db
    .delete(savedShops)
    .where(
      and(
        eq(savedShops.clientWalletAddress, clientWalletAddress),
        eq(savedShops.providerProfileId, providerProfileId),
      ),
    )
    .run();

  return result.changes > 0;
}

/**
 * Checks if a shop is saved by a client.
 */
export async function isShopSavedByClient(
  db: Db,
  clientWalletAddress: string,
  providerProfileId: string,
): Promise<boolean> {
  const saved = await db
    .select()
    .from(savedShops)
    .where(
      and(
        eq(savedShops.clientWalletAddress, clientWalletAddress),
        eq(savedShops.providerProfileId, providerProfileId),
      ),
    )
    .get();

  return saved !== undefined;
}

export interface SavedShopWithProvider {
  savedShop: SavedShopRow;
  provider: {
    id: string;
    displayName: string;
    title: string;
    location: string;
    categoryId: string;
    sessionFormat: string;
    sessionLengthMinutes: number;
    priceAmount: string;
    depositRateBps: number;
    cancellationWindowHours: number;
    isApproved: boolean;
    verifiedSessionCount: number;
  };
}

/**
 * Lists all saved shops for a client, with provider details, most recently
 * saved first. Includes shops that are suspended or paused (isApproved false)
 * so the client knows they're not taking bookings.
 */
export async function listSavedShopsForClient(db: Db, clientWalletAddress: string): Promise<SavedShopWithProvider[]> {
  const rows = await db
    .select({
      savedShop: savedShops,
      provider: {
        id: providerProfiles.id,
        displayName: providerProfiles.displayName,
        title: providerProfiles.title,
        location: providerProfiles.location,
        categoryId: providerProfiles.categoryId,
        sessionFormat: providerProfiles.sessionFormat,
        sessionLengthMinutes: providerProfiles.sessionLengthMinutes,
        priceAmount: providerProfiles.priceAmount,
        depositRateBps: providerProfiles.depositRateBps,
        cancellationWindowHours: providerProfiles.cancellationWindowHours,
        isApproved: providerProfiles.isApproved,
        verifiedSessionCount: providerProfiles.verifiedSessionCount,
      },
    })
    .from(savedShops)
    .innerJoin(providerProfiles, eq(savedShops.providerProfileId, providerProfiles.id))
    .where(eq(savedShops.clientWalletAddress, clientWalletAddress))
    .orderBy(desc(savedShops.createdAt))
    .all();

  return rows;
}
