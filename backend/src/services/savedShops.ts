/**
 * Service functions for saved shops (#73).
 */
import { randomBytes } from "node:crypto";
import type { Db } from "../db/client.js";
import { getProviderProfileById } from "../db/providerProfiles.js";
import {
  saveShopForClient,
  unsaveShopForClient,
  isShopSavedByClient,
  listSavedShopsForClient,
  type SavedShopWithProvider,
} from "../db/savedShops.js";

export class ShopNotFoundError extends Error {
  constructor(message = "No shop was found with that id.") {
    super(message);
    this.name = "ShopNotFoundError";
  }
}

export class ShopNotApprovedError extends Error {
  constructor(message = "This shop is not approved for booking.") {
    super(message);
    this.name = "ShopNotApprovedError";
  }
}

function generateSavedShopId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Saves a shop for a signed-in client. Only approved shops can be saved.
 * Saving twice is a no-op (idempotent).
 */
export async function saveShop(
  db: Db,
  clientWalletAddress: string,
  providerProfileId: string,
  now: number,
): Promise<{ savedShopId: string }> {
  // Validate shop exists and is approved
  const provider = await getProviderProfileById(db, providerProfileId);
  if (!provider) {
    throw new ShopNotFoundError();
  }

  if (!provider.isApproved) {
    throw new ShopNotApprovedError();
  }

  // Save the shop (idempotent)
  const savedShopId = generateSavedShopId();
  await saveShopForClient(db, {
    id: savedShopId,
    clientWalletAddress,
    providerProfileId,
    createdAt: now,
  });

  return { savedShopId };
}

/**
 * Unsaves a shop for a signed-in client.
 */
export async function unsaveShop(
  db: Db,
  clientWalletAddress: string,
  providerProfileId: string,
): Promise<{ unsaved: boolean }> {
  const unsaved = await unsaveShopForClient(db, clientWalletAddress, providerProfileId);
  return { unsaved };
}

/**
 * Checks if a shop is saved by the client.
 */
export async function isShopSaved(
  db: Db,
  clientWalletAddress: string,
  providerProfileId: string,
): Promise<{ isSaved: boolean }> {
  const isSaved = await isShopSavedByClient(db, clientWalletAddress, providerProfileId);
  return { isSaved };
}

export interface SavedShopListItem {
  id: string;
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
  savedAt: number;
}

/**
 * Lists all saved shops for the signed-in client, most recently saved first.
 * Includes shops that are suspended or paused (not taking bookings).
 */
export async function getSavedShopsForClient(db: Db, clientWalletAddress: string): Promise<SavedShopListItem[]> {
  const saved = await listSavedShopsForClient(db, clientWalletAddress);

  return saved.map((s) => ({
    id: s.savedShop.id,
    provider: s.provider,
    savedAt: s.savedShop.createdAt,
  }));
}
