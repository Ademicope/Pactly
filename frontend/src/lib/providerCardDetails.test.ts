import assert from "node:assert/strict";
import { test } from "node:test";

import { providerCardDetails } from "./providerCardDetails.js";

test("provider card details use stored length and name additional services", () => {
  assert.deepEqual(
    providerCardDetails({
      sessionLengthMinutes: 30,
      serviceCount: 2,
      priceAmount: "25000000",
    }),
    { lengthLabel: "30 min · more services", hasPrice: true },
  );
});

test("provider card details mark a missing price as unset instead of zero", () => {
  assert.equal(
    providerCardDetails({ sessionLengthMinutes: 45, priceAmount: "" }).hasPrice,
    false,
  );
});
