# PayPal Integration & Double-Entry Ledger Architecture

## Endpoints & APIs Used
1. **OAuth 2.0 Client Credentials** (`POST /v1/oauth2/token`): Authenticates with `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
2. **Orders API v2** (`POST /v2/checkout/orders` & `POST /v2/checkout/orders/{id}/capture`):
   - Triggered by `POST /projects/{id}/fund` and `POST /projects/{id}/fund/capture` (or redirected via `/funding/return`).
   - Captures the donor's pledge upfront with `intent: "CAPTURE"`.
   - Strictly validates capture status (`COMPLETED`), amount match, currency match, and capture ID global uniqueness against replay attacks.
   - Posts a balanced double-entry journal entry: Debit `Assets:PayPal_Escrow_Holdings`, Credit `Liabilities:Grantee_Escrow_Allocation`.
3. **Payouts API v1** (`POST /v1/payments/payouts`):
   - Triggered by `POST /payouts/{milestone_id}/execute` and `POST /projects/{id}/release-holdback`.
   - Uses `PayPal-Request-Id` and deterministic `sender_batch_id` (`milestone-{id}-{attempt}`) for end-to-end network idempotency.
   - Pre-records payout intent in PostgreSQL with status `PENDING` to ensure crash-recovery reconciliation.
4. **Webhook Signature Verification** (`POST /v1/notifications/verify-webhook-signature`):
   - Exposed at `POST /webhooks/paypal`.
   - Cryptographically verifies the webhook signature using `PAYPAL_WEBHOOK_ID`.
   - Handles both Item-level (`PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `FAILED`, `DENIED`, `UNCLAIMED`, `HELD`, `REFUNDED`, `BLOCKED`, `CANCELED`) and Batch-level events (`PAYMENT.PAYOUTSBATCH.SUCCESS`, `PROCESSING`, `DENIED`).
   - Webhook idempotency is guaranteed via event ID deduplication in the audit trail.
   - Upon final payout settlement (`SUCCESS`), posts the balanced double-entry journal entry: Debit `Liabilities:Grantee_Escrow_Allocation`, Credit `Assets:PayPal_Escrow_Holdings`.

---

## Double-Entry General Ledger

ImpactRelease maintains a formal balanced double-entry accounting ledger in PostgreSQL (`JournalEntry` table), exposed via:
- `GET /ledger/journal`: Full chronologically ordered double-entry journal entries.
- `GET /ledger/journal/verify?project_id={id}`: Mathematical verification asserting `total_debits == total_credits` and calculating net balances across all accounts.

### Chart of Accounts
- `Assets:PayPal_Escrow_Holdings`: Tracks funds physically held in the PayPal merchant escrow wallet.
- `Liabilities:Grantee_Escrow_Allocation`: Tracks the platform's obligation to disburse verified milestone tranches to field NGOs.

---

## Architecture & Compliance Analysis

### 1. Physical vs. Logical Fund Segregation
- **Hackathon Sandbox Implementation:** Standard PayPal developer accounts utilize an omnibus merchant balance where all captured funds reside. Physical per-grant bank accounts are not supported by standard SMB PayPal REST APIs.
- **ImpactRelease Logical Reservation:** The platform enforces strict fund isolation at the database and application tier. Grants cannot exceed their allocated, captured funding balance (`available = funded_amount - released_amount`). Double-entry ledger entries strictly prevent commingling or over-disbursement.
- **Production Architecture Roadmap:** For production multi-party fund custody, ImpactRelease is designed to integrate with **PayPal Commerce Platform (PPCP) for Marketplaces** with custom partner managed accounts, or partner with a chartered trust bank (via Banking-as-a-Service like Column or Evolve Bank & Trust) to maintain genuine FBO (*For Benefit Of*) segregated escrow accounts.

### 2. Long-Term Fund Custody & Regulatory Review
- **28-Day Deadline Avoidance:** Unlike authorization holds that expire after 29 days, ImpactRelease captures funds immediately on project funding into the escrow wallet, allowing grants to execute across months or years.
- **Custody Compliance:** Holding third-party funds for several months falls under Money Transmitter Licensing (MTL) and custodial regulatory frameworks (e.g., FinCEN in the US, PSD2 in the EU). In a commercial deployment:
  - The platform operates either under an agent-of-the-payee exemption, or
  - Partners with a licensed escrow provider / trust institution (PPCP or licensed trust rail) that directly holds the regulatory custody license, keeping ImpactRelease in the role of non-custodial milestone orchestration and AI verification engine.
