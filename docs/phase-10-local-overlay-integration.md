# Phase 10 Local Overlay Integration

This integration keeps cloud/public cache payloads clean while still allowing the local app to show private context after a public cached search result is loaded.

## Boundary

Public search cache payload:

- contains only public query/result fields
- may be stored in local SQLite or a future cloud cache
- must not contain watchlist, account, purchase, annotation, target-price, or subscription data

Local overlay payload:

- is applied after the public payload is read
- can add local watchlist state, target prices, local annotations, account list membership, account point context, and person subscription summary
- is marked with `localOverlay.private: true`
- carries `claimsEntitlement: false` so the UI does not imply coupon ownership or DLsite eligibility

## Implementation

- `applyLocalSearchOverlay(publicPayload, localOverlay)` returns a cloned display payload.
- The original public payload is not mutated.
- `buildPublicSearchCachePayload()` still strips the overlay if an overlaid display payload is accidentally passed back into public-cache serialization.

## Local Context Shape

The overlay function accepts these local-only sources:

- `watchlist`: array of `{ productId, targetPriceJpy, source }`
- `annotations`: array of `{ productId, note, tags, status }`
- `account`: local account snapshot with optional `pointsJpy`, `isStale`, and `lists`
- `accountLists`: local account list product ids when they are provided separately
- `subscriptions`: person subscription summaries

This keeps public cache reads portable while preserving the current local-first personalization model.
