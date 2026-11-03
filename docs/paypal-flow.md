# PayPal Integration Flow

## Endpoints & APIs Used
1. **OAuth 2.0 Client Credentials** (`POST /v1/oauth2/token`): Authenticates with `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
2. **Orders API v2** (`POST /v2/checkout/orders` & `POST /v2/checkout/orders/{id}/capture`):
   - Triggered by `POST /projects/{id}/fund` and `POST /projects/{id}/fund/capture`.
   - Captures the donor's contribution and transitions the project from `DRAFT` to `FUNDED`.
3. **Payouts API v1** (`POST /v1/payments/payouts`):
   - Triggered by `POST /payouts/{milestone_id}/execute` (and `POST /projects/{id}/release-holdback`).
   - Uses a deterministic `sender_batch_id` (`milestone-{id}-{attempt}`) for idempotency.
4. **Webhook Signature Verification** (`POST /v1/notifications/verify-webhook-signature`):
   - Exposed at `POST /webhooks/paypal`.
   - Handles `PAYMENT.PAYOUTSBATCH.SUCCESS`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `PAYMENT.PAYOUTS-ITEM.FAILED`, `PAYMENT.PAYOUTS-ITEM.DENIED`, and `PAYMENT.PAYOUTS-ITEM.UNCLAIMED`.

## Stub Mode vs. Sandbox Mode
- `PAYPAL_MODE=stub` (default for local runs and CI): Uses [`StubPayPal`](../backend/app/services/paypal_client.py), an in-memory deterministic adapter with idempotency and webhook support.
- `PAYPAL_MODE=sandbox`: Calls `https://api-m.sandbox.paypal.com` with `PayPal-Request-Id` idempotency headers.
