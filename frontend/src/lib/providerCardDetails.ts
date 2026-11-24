export function providerCardDetails(input: {
  sessionLengthMinutes: number;
  serviceCount?: number;
  priceAmount?: string | null;
}): { lengthLabel: string; hasPrice: boolean } {
  const count = Math.max(1, input.serviceCount ?? 1);
  return {
    lengthLabel: `${input.sessionLengthMinutes} min${count > 1 ? " · more services" : ""}`,
    hasPrice: typeof input.priceAmount === "string" && input.priceAmount.length > 0,
  };
}
