"""Run the synthetic red-team evaluation suite and write eval/results.md."""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

os.environ["EVIDENCE_DIR"] = tempfile.mkdtemp(prefix="ir_redteam_")
os.environ.setdefault("LLM_PROVIDER", "offline")

from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session, SQLModel, create_engine  # noqa: E402

from app.db import models  # noqa: F401, E402
from app.services.redteam import run_redteam_suite  # noqa: E402


def main() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        summary = run_redteam_suite(session)

    lines = [
        "# ImpactRelease — Synthetic Red-Team Evaluation Report",
        "",
        f"> **Note:** {summary['Note']}",
        "",
        "## Summary Metrics (Simulated Benchmark)",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Total simulated scenarios | {summary['total_cases']} |",
        f"| Synthetic attack scenarios | {summary['attack_cases']} |",
        f"| Attacks blocked before payout | {summary['attacks_caught']} / {summary['attack_cases']} ({int(summary['attack_detection_rate'] * 100)}%) |",
        f"| Legitimate scenarios | {summary['legitimate_cases']} |",
        f"| False rejections on legitimate scenarios | {summary['false_rejections']} / {summary['legitimate_cases']} ({int(summary['false_rejection_rate'] * 100)}%) |",
        "",
        "## Per-Scenario Breakdown",
        "",
        "| Scenario | Type | Decision | Status | Skeptic Risk | Skeptic Concerns | Unmet Hard Rules | Correct |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for c in summary["cases"]:
        kind = "Attack" if c["is_attack"] else "Legitimate"
        concerns = ", ".join(c["concerns"]) or "None"
        failed = ", ".join(c["failed_rules"]) or "None"
        ok = "PASS" if c["correct"] else "FAIL"
        lines.append(
            f"| `{c['case']}` | {kind} | `{c['decision']}` | `{c['milestone_status']}` | "
            f"{c['skeptic_risk']:.2f} | {concerns} | {failed} | **{ok}** |"
        )

    lines.extend([
        "",
        "## Residual Risks (Not Eliminated by Software Alone)",
        "- **Multi-party collusion:** If the NGO, vendor, and sampled beneficiaries all collude, software checks can be bypassed; mitigated via random independent field audits, network collusion graph alerts (`/graph/risk`), and small tranche sizes.",
        "- **Coerced confirmers:** Beneficiaries pressured into confirming delivery; mitigated via private single-use links and anonymous challenge-window disputes.",
        "- **Device/GPS sensor spoofing:** Rooted devices or GPS emulators; treated as weak signals that never replace third-party confirmation.",
    ])

    out_path = ROOT / "eval" / "results.md"
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out_path} ({summary['attacks_caught']}/{summary['attack_cases']} attacks blocked)")


if __name__ == "__main__":
    main()
