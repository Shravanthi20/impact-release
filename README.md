# ImpactRelease

Programmable generosity: donors state an intent, AI agents turn it into verifiable milestones,
check evidence from several independent angles, and release funds in tranches through
**PayPal Payouts**, with an explained, public ledger.

> Status: **All 8 Phases Complete** (Full-stack web UI + AG Grid Reviewer Console & Public Ledger, Gemini Contract/Verifier/Skeptic/Release agents with `STRICT_GEMINI_ONLY` enforcement, PayPal Orders/Payouts/Webhooks, 64-bit perceptual dHash & Elastic duplicate search, third-party confirmations, deterministic rules engine, challenge window, retention holdback, 12-case Red-Team benchmark, Network Collusion Graph, Render & Docker configs, and Postman collection)..
> Fraud is made costlier and more likely to be caught. It is not eliminated.

## Run it locally

```powershell
# 1. Start the FastAPI backend (also serves the pre-built React production bundle at http://localhost:8000)
cd backend
python -m venv ..\.venv
..\.venv\Scripts\pip install -r requirements.txt
copy ..\.env.example ..\.env        # PAYPAL_MODE=stub works with no credentials
..\.venv\Scripts\python -m uvicorn app.main:app --reload
```

For hot-reloading frontend development (React 18 + Vite + Tailwind CSS + AG Grid):
```powershell
cd frontend
npm install
npm run dev                         # Runs Vite dev server on http://localhost:5173 (proxied to :8000)
npm run build                       # Builds production bundle into frontend/dist
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

## Phase 4: verification, skeptic agent, and duplicate search
- `POST /submissions/{id}/analyze` & `GET /submissions/{id}/analysis`.
- **Verifier agent** ([`verifier_agent.py`](backend/app/agents/verifier_agent.py)): multimodal Gemini vision + offline fallback checks whether the one-time challenge code appears in the frame, extracts receipt amounts/text, and matches evidence against milestone requirements.
- **Similarity & duplicate search** ([`similarity.py`](backend/app/services/similarity.py)): computes 64-bit perceptual difference hashes (`dHash`) so resized or recompressed duplicate photos are caught across all projects even when SHA-256 differs, plus receipt-text Jaccard similarity and optional Elasticsearch indexing/search (`SIMILARITY_BACKEND=elastic`).
- **Adversarial Skeptic agent** ([`skeptic_agent.py`](backend/app/agents/skeptic_agent.py)): combines deterministic fraud signals (exact/near-duplicate images, missing challenge code, receipt amount mismatch, non-in-app capture) with an adversarial LLM pass. Deterministic rules set a floor on `fraud_risk` that the LLM can raise but never lower.

## Phase 5: confirmations, rules engine, challenge window, and holdback
- `POST /milestones/{id}/confirmations/invite` & `GET/POST /confirm/{token}`: single-use tokenized vendor, beneficiary, and witness confirmations (only SHA-256 token hashes are stored). Detects denials, reported amount mismatches, and rehearsed/identical beneficiary replies (`REHEARSED_CONFIRMATION`).
- `POST/GET /milestones/{id}/decision`: runs the deterministic [`rules_engine.py`](backend/app/services/rules_engine.py) (`project_funded`, `challenge_code_verified`, `skeptic_cleared`, `independent_confirmation_met`, `no_open_disputes`, `within_auto_approval_limit`) and the [`release_agent.py`](backend/app/agents/release_agent.py). The LLM cannot upgrade a non-release rule outcome to `release`.
- `POST /milestones/{id}/dispute`, `GET /review/queue`, & `POST /review/{id}/decision`: challenge window holds, dispute escalation, and human reviewer resolution.
- `POST /projects/{id}/release-holdback`: releases the retained holdback tranche only after all regular milestones have settled with no open disputes.

## Phase 6: Production React Role-Based Frontend & Human-Readable Audit Trail
- Built with **React 18**, **Vite 5**, **Tailwind CSS 3**, **`ag-grid-react`**, and **`lucide-react`** ([`frontend/src/App.jsx`](frontend/src/App.jsx)).
- Organized into 5 role-based workspaces:
  1. **Donor Portal** ([`DonorWorkspace.jsx`](frontend/src/components/DonorWorkspace.jsx)): Grant portfolio tracking, Gemini Contract Agent milestone structuring, PayPal Order funding, and retention holdback release.
  2. **NGO Field Partner** ([`NgoWorkspace.jsx`](frontend/src/components/NgoWorkspace.jsx)): One-time 6-digit challenge code generation, WebRTC live camera + real file upload, multimodal Gemini Verifier & Skeptic inspection, third-party invite dispatch, and PayPal tranche payout execution.
  3. **External Verifier** ([`VerifierWorkspace.jsx`](frontend/src/components/VerifierWorkspace.jsx)): Independent Vendor/Beneficiary magic-link attestation portal and whistleblower challenge-window dispute filing.
  4. **Compliance Auditor** ([`AuditorWorkspace.jsx`](frontend/src/components/AuditorWorkspace.jsx)): `AgGridReact` escalation queue (`#reviewGrid`), side-by-side case inspector with manual override (`APPROVE`/`REJECT`), Network Collusion Graph monitor, and 12-scenario Red-Team benchmark runner.
  5. **Public Transparency** ([`PublicWorkspace.jsx`](frontend/src/components/PublicWorkspace.jsx) & [`AuditTimeline.jsx`](frontend/src/components/AuditTimeline.jsx)): Zero-PII `AgGridReact` public disbursement ledger (`#ledgerGrid`) with CSV export and a categorized, searchable, plain-English Security Audit Trail.

## Phase 7 & 8: Red-Team Benchmark, Collusion Graph, Deployment & Docs
- **Red-Team Evaluation Suite** (`POST /eval/redteam/run`, [`eval/run_redteam.py`](eval/run_redteam.py), [`eval/results.md`](eval/results.md)): runs 12 synthetic scenarios (9 attack vectors + 3 legitimate baselines) across all defense layers.
- **Network Collusion Graph** (`GET /graph/risk`, [`graph.py`](backend/app/services/graph.py)): flags shared devices across distinct NGO accounts (`SHARED_DEVICE_ACROSS_NGOS`) and repeat confirmers across projects (`REPEAT_CONFIRMER_ACROSS_PROJECTS`).
- **Strict Gemini Enforcement**: when `LLM_PROVIDER=gemini` and `STRICT_GEMINI_ONLY=true` (default), all 4 agents (`Contract`, `Verifier`, `Skeptic`, `Release`) execute exclusively via the Google Gemini API; verified end-to-end with [`backend/scripts/verify_all_gemini_agents.py`](backend/scripts/verify_all_gemini_agents.py).
- **Deployment & Tooling**: [`render.yaml`](render.yaml), [`Dockerfile`](Dockerfile), [`docker-compose.yml`](docker-compose.yml), [`postman/impactrelease.postman_collection.json`](postman/impactrelease.postman_collection.json), and [`docs/`](docs/).

## Roadmap
| Phase | Scope | Status |
|---|---|---|
| 0 | Repo, license, config, stub PayPal | Done |
| 1 | PayPal core: fund, payout, webhooks, ledger | Done |
| 2 | Contract agent: intent to milestones | Done |
| 3 | In-app capture, challenge codes, evidence hashing | Done |
| 4 | Verifier + skeptic agents, perceptual-hash & Elastic duplicate search | Done |
| 5 | Confirmations, rules engine, challenge window, holdback | Done |
| 6 | Reviewer console and public ledger UI (AG Grid) | Done |
| 7 | Red-team eval and network collusion graph | Done |
| 8 | Docs, Render & Docker configs, Postman collection | Done |

## Limitations
Sandbox prototype. Holding donor funds is regulated; a real deployment would use a registered
fiscal sponsor. Collusion, coerced beneficiaries, sensor spoofing and very realistic fakes remain
residual risks.

## License
MIT, see [LICENSE](LICENSE).
