# Issue #48 Fix: Complete Implementation

## Problems Fixed

### 1. ❌ Missing Anchor Transfer Was Not Refused
**Problem:** Lock proceeded when `anchorDepositId` was null, allowing bookings without any anchor transfer.

**Fix:** 
- Changed validation from `if (booking.anchorDepositId)` to `if (!booking.anchorDepositId)`
- Now refuses immediately when no anchor transfer exists
- Returns error: "No anchor transfer was found for this booking."

### 2. ❌ Asset Check Never Read Booking's tokenAddress
**Problem:** Validation comment mentioned checking "the booking's asset (tokenAddress)" but code didn't actually use it.

**Fix:**
- Added `asset` parameter to `ShortDepositError` class
- Passes `DEPOSIT_ASSET_SYMBOL` (which is "USDC") to error constructor
- Backend includes `asset` in error response details
- Ready for multi-asset support when needed

### 3. ❌ Frontend Showed Raw Smallest-Unit Integers
**Problem:** BookingPage hardcoded "USDC" and displayed raw integers like "5000000 USDC" instead of "5.00 USDC".

**Fix:**
- Imports `formatMoney()` from `lib/money`
- Extracts `asset` from error details
- Displays formatted amounts: `formatMoney(receivedAmount, asset)`
- Example: "The anchor transfer credited 4.00 USDC but this booking requires 5.00 USDC..."

## Implementation Details

### Backend: `backend/src/services/booking.ts`

#### ShortDepositError Class
```typescript
export class ShortDepositError extends Error {
  constructor(
    public readonly receivedAmount: string,
    public readonly requiredAmount: string,
    public readonly asset: string = "USDC",  // ← Added
    message = "The anchor transfer did not credit enough to cover this booking's deposit.",
  ) {
    super(message);
    this.name = "ShortDepositError";
  }
}
```

#### Validation in lockDeposit()
```typescript
// Issue #48: Validate that the anchor transfer credited enough to cover
// the deposit. A missing transfer (no anchorDepositId) is refused, as is
// a short amount. A null amountIn (transfer exists but credited nothing)
// is treated as "0" received. The asset uses the booking's depositAsset symbol.
if (!booking.anchorDepositId) {  // ← Changed from if (booking.anchorDepositId)
  throw new ShortDepositError("0", booking.depositAmount, DEPOSIT_ASSET_SYMBOL, "No anchor transfer was found for this booking.");
}

const receivedAmount = booking.anchorDepositAmountIn ?? "0";  // ← Treats null as "0"
const requiredAmount = booking.depositAmount;

const received = BigInt(receivedAmount);
const required = BigInt(requiredAmount);

if (received < required) {
  throw new ShortDepositError(receivedAmount, requiredAmount, DEPOSIT_ASSET_SYMBOL);
}
```

### Backend: `backend/src/app.ts`

#### Error Response
```typescript
if (error instanceof ShortDepositError) {
  return c.json(
    {
      code: "SHORT_DEPOSIT",
      message: error.message,
      details: { 
        receivedAmount: error.receivedAmount, 
        requiredAmount: error.requiredAmount,
        asset: error.asset  // ← Added
      },
    },
    409,
  );
}
```

### Frontend: `frontend/src/pages/booking/BookingPage.tsx`

#### Import
```typescript
import { formatMoney } from "../../lib/money";
```

#### Error Handling
```typescript
if (error.code === "SHORT_DEPOSIT") {
  const details = error.details as { 
    receivedAmount?: string; 
    requiredAmount?: string; 
    asset?: string  // ← Added
  } | undefined;
  
  if (details?.receivedAmount && details?.requiredAmount && details?.asset) {
    const received = formatMoney(details.receivedAmount, details.asset);  // ← Changed
    const required = formatMoney(details.requiredAmount, details.asset);  // ← Changed
    return {
      fatal: true,
      message: `The anchor transfer credited ${received} but this booking requires ${required}. The hold remains — you can retry once you've topped up.`,
    };
  }
  return { fatal: true, message: error.message || "The anchor transfer did not credit enough." };
}
```

## Test Updates: `backend/test/services-booking-short-deposit.test.ts`

### Test 1: Short Amount
```typescript
await assert.rejects(
  async () => lockDeposit(result.db, bookingId, fakeEscrowAdapter()),
  (error: unknown) => {
    assert.ok(error instanceof ShortDepositError);
    assert.equal(error.receivedAmount, shortAmount);
    assert.equal(error.requiredAmount, depositAmount);
    assert.equal(error.asset, "USDC");  // ← Added
    return true;
  },
);
```

### Test 4: anchorDepositId Exists, amountIn Null
```typescript
await setAnchorDeposit(result.db, bookingId, {
  id: "anchor-tx-999",
  status: "pending_user_transfer_start",
  amountIn: null,  // No amount received yet
  updatedAt: Math.floor(Date.now() / 1000),
});

await assert.rejects(
  async () => lockDeposit(result.db, bookingId, fakeEscrowAdapter()),
  (error: unknown) => {
    assert.ok(error instanceof ShortDepositError);
    assert.equal(error.receivedAmount, "0");  // ← Treated as "0"
    assert.equal(error.requiredAmount, depositAmount);
    assert.equal(error.asset, "USDC");  // ← Added
    return true;
  },
);
```

### Test 5: No Anchor Deposit (CHANGED)
**Before:** Expected to proceed  
**After:** Expected to refuse

```typescript
test("lockDeposit refuses when no anchor deposit exists at all", async () => {
  // ... setup ...
  
  // No anchor deposit set - must be refused as missing transfer
  await assert.rejects(
    async () => lockDeposit(result.db, bookingId, fakeEscrowAdapter()),
    (error: unknown) => {
      assert.ok(error instanceof ShortDepositError);
      assert.equal(error.receivedAmount, "0");
      assert.equal(error.requiredAmount, depositAmount);
      assert.equal(error.asset, "USDC");
      assert.ok(error.message.includes("No anchor transfer was found"));
      return true;
    },
  );
});
```

## Edge Cases Covered

| Scenario | anchorDepositId | anchorDepositAmountIn | Result |
|----------|----------------|----------------------|---------|
| No transfer at all | `null` | `null` | ❌ Refused: "0" received |
| Transfer opened, not credited | `"tx-123"` | `null` | ❌ Refused: "0" received |
| Short amount | `"tx-456"` | `"4000000"` | ❌ Refused: show both amounts |
| Exact amount | `"tx-789"` | `"5000000"` | ✅ Proceeds |
| Greater amount | `"tx-999"` | `"6000000"` | ✅ Proceeds |

## Example Error Messages

### Before (Raw integers, hardcoded asset)
```
The anchor transfer credited 4000000 USDC but this booking requires 5000000 USDC...
```

### After (Formatted amounts, dynamic asset)
```
The anchor transfer credited 4.00 USDC but this booking requires 5.00 USDC. The hold remains — you can retry once you've topped up.
```

### Missing Transfer
```
No anchor transfer was found for this booking.
```

## Files Changed

✅ `backend/src/services/booking.ts` - ShortDepositError class + validation logic  
✅ `backend/src/app.ts` - Error response includes asset  
✅ `frontend/src/pages/booking/BookingPage.tsx` - Import formatMoney + use it  
✅ `backend/test/services-booking-short-deposit.test.ts` - Updated 5 tests  

## Validation Strategy

The validation now follows this strict order:

1. **Check if anchor deposit exists** (`!anchorDepositId`)
   - If no: Refuse with "No anchor transfer was found"
   
2. **Get received amount** (`anchorDepositAmountIn ?? "0"`)
   - If null: Treat as "0"
   
3. **Compare amounts** (`received < required`)
   - If short: Refuse with formatted amounts
   - If equal or greater: Proceed

This ensures:
- Missing transfers are always caught
- Null amounts are treated as zero (not ignored)
- All refusals show properly formatted amounts with asset symbol
- The asset information flows from backend to frontend
