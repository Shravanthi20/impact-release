# Privacy, Safety, and Regulatory Notes

1. **Zero PII in the Public Ledger:** `GET /ledger/public` exposes only project IDs, milestone titles, tranche amounts, payout statuses, and anonymized Release Agent explanations. Personal emails, phone numbers, and beneficiary names are never included.
2. **Hashed Confirmation Tokens:** Invite tokens sent to vendors, beneficiaries, and witnesses are hashed with SHA-256 (`Confirmation.token_hash`) before storage.
3. **Prompt-Injection Defenses:** Donor intents, filenames, OCR text, and confirmation responses are wrapped inside untrusted XML tags, and hard deterministic rules set a floor that LLM outputs cannot override.
4. **Custody & Regulatory Disclaimer:** ImpactRelease is a hackathon sandbox prototype. In a production deployment, holding and disbursing charitable funds requires partnering with a licensed fiscal sponsor or registered donor-advised fund (DAF) provider.
