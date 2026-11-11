# Privacy, Ethics & Regulatory Compliance

ImpactRelease is engineered to provide maximum financial transparency and fraud deterrence while rigorously safeguarding the privacy, safety, and dignity of aid beneficiaries, local vendors, and field personnel.

🌐 **Production Deployment:** [https://impact-release.onrender.com/](https://impact-release.onrender.com/)  
📖 **API Documentation (Swagger UI):** [https://impact-release.onrender.com/docs](https://impact-release.onrender.com/docs)

---

## 1. Zero-PII Public Transparency Ledger
The public ledger (`GET /ledger/public`) allows donors, journalists, and public auditors to verify the integrity of grant disbursements without exposing vulnerable beneficiaries:
- **Redacted Identifiers:** Personal emails, phone numbers, home coordinates, and beneficiary names are strictly filtered prior to ledger serialization.
- **Content-Addressed Digests:** Evidence files are referenced solely by their SHA-256 cryptographic digests and perceptual hashes.
- **Anonymized Justifications:** The Release Decision Agent's plain-language release justification is scrubbed of individual names, focusing purely on milestone criteria fulfillment.

---

## 2. Tokenized & Hashed Beneficiary Attestations
- **Ephemeral Magic-Links:** External verifiers (local suppliers, village elders, community representatives) receive single-use, expirable verification links.
- **Cryptographic Storage:** Raw invitation tokens are never stored in plaintext in the database. Instead, only the SHA-256 hash (`Confirmation.token_hash`) is persisted.
- **Non-Coercive Dispute Mechanism:** Verifier portals include a frictionless challenge-window dispute flow that allows community members to flag non-delivery or coercive behavior anonymously.

---

## 3. Prompt-Injection & Adversarial AI Defenses
LLMs operating within financial workflows are potential targets for adversarial prompt-injection (e.g. attempting to instruct the model to ignore missing evidence):
- **Untrusted XML Delimiters:** All untrusted user inputs (donor intents, filenames, OCR text extracts, confirmer comments) are wrapped in rigid `<user_content>` and `<evidence_data>` tags within agent system prompts.
- **Deterministic Rules Floor:** LLMs **never** make financial release decisions autonomously. The Release Decision Agent provides natural-language justifications only after the **Deterministic 6-Rule Gate** confirms 100% compliance with funding, AI confidence, fraud thresholds, and third-party attestations. An LLM cannot lower a fraud score below the deterministic floor or waive an unmet hard rule.

---

## 4. Ethical AI & Humanitarian Safeguards
- **Dignity in Field Evidence:** Field workers are encouraged to capture equipment placards, invoices, and flow meters rather than identifying beneficiary faces. 
- **Proportionate Verification:** Requirements are scaled to milestone values. Small tranches avoid placing undue administrative burdens on local community volunteers.
- **Human-in-the-Loop Safeguards:** Any submission flagged for high fraud risk or outcome ambiguity is routed to the **Auditor Workspace** for human review rather than being arbitrarily rejected by an AI algorithm.

---

## 5. Regulatory Custody & Compliance Notice
- **Sandbox Prototype vs. Production Custody:** ImpactRelease demonstrates end-to-end milestone-gated grant distribution using the PayPal Developer Platform. In a commercial production deployment across international jurisdictions, holding charitable funds long-term requires partnering with a licensed 501(c)(3) fiscal sponsor, registered Donor-Advised Fund (DAF) sponsor, or operating under an authorized Money Services Business (MSB) / Money Transmitter License (MTL) framework.
- **Sanctions & Global KYC:** Payouts routed via the PayPal Payouts REST API rely on PayPal's comprehensive global identity verification and OFAC sanctions screening on all recipient email accounts.
