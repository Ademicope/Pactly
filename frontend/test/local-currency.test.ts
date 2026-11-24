import assert from "node:assert/strict";
import { test } from "node:test";

import { formatCurrency, usdcToCurrency } from "../src/lib/money";

test("anchor currency configuration renders USD instead of TRY", () => {
  const rate = "1.25";
  const decimals = 2;
  const rendered = formatCurrency("4500000000", rate, "USD", decimals);

  assert.equal(rendered, "562.50 USD");
  assert.equal(rendered.includes("TRY"), false);
  assert.equal(usdcToCurrency("4500000000", rate, 3), "562.500");
});
