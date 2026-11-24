export function truncateWalletAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function signingAddressMismatch(
  shownAddress: string | undefined,
  sessionAddress: string | undefined,
): boolean {
  return !shownAddress || !sessionAddress || shownAddress !== sessionAddress;
}
