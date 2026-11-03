# Layered Anti-Fraud Model

ImpactRelease is designed around a 7-layer defense-in-depth architecture to make fabricating or reusing evidence costly and likely to be caught:

| Layer | Implementation | Attack Vectors Caught |
|---|---|---|
| **1. Capture Controls** | Single-use 6-digit challenge codes (30-min TTL), capture-window validation, `in_app_camera` source tracking, SHA-256 hashing | Pre-made photos, expired/replayed challenges, gallery uploads |
| **2. Automated Cross-Checks (Verifier & Skeptic)** | Multimodal Gemini Vision challenge-code & receipt OCR check, 64-bit perceptual `dHash` across all projects, receipt text Jaccard similarity, optional Elasticsearch index | Missing challenge code, exact duplicates, resized/recompressed duplicate images, inflated receipt mismatches |
| **3. Independent Third-Party Proof** | Single-use SHA-256 hashed tokens for vendors, sampled beneficiaries, and local witnesses; rehearsed-text Jaccard detector | Uncorroborated NGO claims, denied deliveries, colluding/scripted beneficiary replies |
| **4. Economic Deterrence** | Tranche payouts, 10% final retention holdback (`release-holdback`), pre-payout challenge windows (`challenge_window_hours`), trust-tier auto-approval caps | Lump-sum theft, hit-and-run defaults |
| **5. Network Collusion Graph** | [`graph.py`](../backend/app/services/graph.py) (`GET /graph/risk`) tracking shared device IDs across NGOs and repeat confirmers across projects | Sybil NGO accounts sharing one phone, professional fake confirmers |
| **6. Human Reviewer Console** | AG Grid queue (`GET /review/queue`, `POST /review/{id}/decision`) sorted by Skeptic fraud risk | Borderline anomalies, challenge-window disputes |
| **7. Continuous Red-Team Benchmark** | [`redteam.py`](../backend/app/services/redteam.py) (`POST /eval/redteam/run`, [`eval/results.md`](../eval/results.md)) | Regression testing across 9 attack classes + 3 legitimate baselines |
