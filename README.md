# ImpactRelease

Programmable generosity: donors state an intent, AI agents turn it into verifiable milestones,
check evidence from several independent angles, and release funds in tranches through
**PayPal Payouts**, with an explained, public ledger.

> Status: **Phase 3 complete** (PayPal funding/payout/webhooks/ledger, contract agent via free Gemini tier or offline fallback).
> Fraud is made costlier and more likely to be caught. It is not eliminated.

## Run it locally

```powershell
cd backend
python -m venv ..\.venv
..\.venv\Scripts\pip install -r requirements.txt
copy ..\.env.example ..\.env        # PAYPAL_MODE=stub works with no credentials
..\.venv\Scripts\python -m uvicorn app.main:app --reload
```

API docs: http://localhost:8000/docs

Run tests: `..\.venv\Scripts\python -m pytest -q`

### Using the real PayPal sandbox
1. Create a REST app at https://developer.paypal.com and copy the client ID and secret.
2. Set `PAYPAL_MODE=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` in `.env`.
3. Payouts must be enabled for your sandbox business account.
4. Register a webhook pointing at `/webhooks/paypal` and set `PAYPAL_WEBHOOK_ID`.
5. Funding in sandbox needs the donor to approve the returned `approve_url` before calling capture.

## Phase 1 flow (implemented)
1. `POST /users`: create donor, NGO (with `paypal_email`).
2. `POST /projects`: project with milestones (tranches cannot exceed the total).
3. `POST /projects/{id}/fund` then `/fund/capture`: PayPal order and capture.
4. `POST /milestones/{id}/approve`: **placeholder** for the verification pipeline (Phase 4-5).
5. `POST /payouts/{milestone_id}/execute`: hard rules, then a PayPal payout. Idempotent.
6. `POST /webhooks/paypal`: signature verified, updates payout and milestone status.
7. `GET /ledger/public` (anonymised) and `GET /audit`.

Guardrail: [`release_service.release_milestone`](backend/app/services/release_service.py) is the
only code path that creates payouts. Amounts above `HUMAN_APPROVAL_THRESHOLD` need human approval.

## Phase 3: evidence capture
- `POST /milestones/{id}/challenge`: one-time 6-digit code, expires after 30 min.
- `POST /milestones/{id}/submissions` (multipart): challenge, capture time, location, device, files.
- Server enforces: single-use code, capture time inside the window, allowed file types, size limit, SHA-256 hashing, content-addressed storage.
- Flags (stored, not blocked): byte-identical file reused anywhere, capture not reported as in-app.
- **Limit:** the server cannot prove a photo came from the in-app camera or that GPS is real. Those fields are claims for later cross-checks. Whether the code appears in the image is checked by the verifier agent in Phase 4.

## Roadmap
| Phase | Scope | Status |
|---|---|---|
| 0 | Repo, license, config, stub PayPal | Done |
| 1 | PayPal core: fund, payout, webhooks, ledger | Done |
| 2 | Contract agent: intent to milestones | Done |
| 3 | In-app capture, challenge codes, evidence hashing | Done |
| 4 | Verifier + skeptic agents, Elastic duplicate search | Next |
| 5 | Confirmations, rules engine, challenge window, holdback | |
| 6 | Reviewer console and public ledger UI (AG Grid) | |
| 7 | Red-team eval and hardening | |
| 8 | Docs, deploy to Render, demo video | |

## Limitations
Sandbox prototype. Holding donor funds is regulated; a real deployment would use a registered
fiscal sponsor. Collusion, coerced beneficiaries, sensor spoofing and very realistic fakes remain
residual risks.

## License
MIT, see [LICENSE](LICENSE).
