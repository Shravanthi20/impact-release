# ImpactRelease — Synthetic Red-Team Evaluation Report

> **Note:** Synthetic red-team benchmark on simulated attacks; not a claim of real-world accuracy.

## Summary Metrics (Simulated Benchmark)

| Metric | Value |
|---|---|
| Total simulated scenarios | 12 |
| Synthetic attack scenarios | 9 |
| Attacks blocked before payout | 9 / 9 (100%) |
| Legitimate scenarios | 3 |
| False rejections on legitimate scenarios | 0 / 3 (0%) |

## Per-Scenario Breakdown

| Scenario | Type | Decision | Status | Skeptic Risk | Skeptic Concerns | Unmet Hard Rules | Correct |
|---|---|---|---|---|---|---|---|
| `legit_vendor_confirmed` | Legitimate | `release` | `APPROVED_FOR_RELEASE` | 0.05 | None | None | **PASS** |
| `legit_beneficiaries_confirmed` | Legitimate | `release` | `APPROVED_FOR_RELEASE` | 0.05 | None | None | **PASS** |
| `legit_witness_confirmed` | Legitimate | `release` | `APPROVED_FOR_RELEASE` | 0.05 | None | None | **PASS** |
| `attack_missing_challenge_code` | Attack | `review` | `HUMAN_REVIEW` | 0.70 | CHALLENGE_CODE_NOT_VISIBLE | challenge_code_verified, skeptic_cleared | **PASS** |
| `attack_exact_duplicate_file` | Attack | `review` | `HUMAN_REVIEW` | 0.95 | EXACT_FILE_DUPLICATE, CHALLENGE_CODE_NOT_VISIBLE | challenge_code_verified, skeptic_cleared | **PASS** |
| `attack_resized_near_duplicate` | Attack | `review` | `HUMAN_REVIEW` | 0.90 | NEAR_DUPLICATE_IMAGE, NEAR_DUPLICATE_IMAGE | skeptic_cleared | **PASS** |
| `attack_inflated_receipt_mismatch` | Attack | `review` | `HUMAN_REVIEW` | 0.65 | RECEIPT_AMOUNT_MISMATCH | skeptic_cleared | **PASS** |
| `attack_gallery_upload_spoof` | Attack | `review` | `HUMAN_REVIEW` | 0.50 | NOT_IN_APP_CAPTURE, MISSING_GEO_METADATA | skeptic_cleared | **PASS** |
| `attack_no_third_party_confirm` | Attack | `needs_more_evidence` | `NEEDS_MORE_EVIDENCE` | 0.05 | None | independent_confirmation_met | **PASS** |
| `attack_vendor_denies_delivery` | Attack | `review` | `HUMAN_REVIEW` | 0.05 | None | independent_confirmation_met | **PASS** |
| `attack_rehearsed_beneficiaries` | Attack | `review` | `HUMAN_REVIEW` | 0.05 | None | independent_confirmation_met | **PASS** |
| `attack_prompt_injection` | Attack | `review` | `HUMAN_REVIEW` | 0.75 | CHALLENGE_CODE_NOT_VISIBLE, RECEIPT_AMOUNT_MISMATCH | challenge_code_verified, skeptic_cleared, independent_confirmation_met | **PASS** |

## Residual Risks (Not Eliminated by Software Alone)
- **Multi-party collusion:** If the NGO, vendor, and sampled beneficiaries all collude, software checks can be bypassed; mitigated via random independent field audits, network collusion graph alerts (`/graph/risk`), and small tranche sizes.
- **Coerced confirmers:** Beneficiaries pressured into confirming delivery; mitigated via private single-use links and anonymous challenge-window disputes.
- **Device/GPS sensor spoofing:** Rooted devices or GPS emulators; treated as weak signals that never replace third-party confirmation.
