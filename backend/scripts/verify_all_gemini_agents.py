"""Live test of all 4 agents against the real Gemini API (no fallback allowed)."""
import io
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image, ImageDraw  # noqa: E402

from app.agents import llm  # noqa: E402
from app.agents.contract_agent import propose_contract  # noqa: E402
from app.agents.release_agent import decide_release  # noqa: E402
from app.agents.skeptic_agent import run_skeptic  # noqa: E402
from app.agents.verifier_agent import verify_submission  # noqa: E402
from app.config import settings  # noqa: E402
from app.services.rules_engine import RuleCheck, RuleEvaluation  # noqa: E402


def make_visual_receipt_image(code: str, amount: float) -> bytes:
    img = Image.new("RGB", (420, 260), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle([10, 10, 410, 80], fill=(15, 23, 42))
    draw.text((25, 32), f"CHALLENGE CODE: {code}", fill=(255, 255, 255))
    draw.rectangle([10, 95, 410, 245], outline=(15, 118, 110), width=3)
    draw.text((25, 115), "PUNE SCHOOL BOARD - OFFICIAL RECEIPT", fill=(0, 0, 0))
    draw.text((25, 150), "Item: Tuition fees for 30 girls (Term 1)", fill=(0, 0, 0))
    draw.text((25, 185), f"TOTAL PAID: USD ${amount:.2f}", fill=(0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


print("Settings -> provider:", settings.llm_provider, "| model:", settings.gemini_model)
assert llm.llm_available(), "Gemini API is not enabled!"

t0 = time.time()
c_out = propose_contract("Fund school fees for 30 girls in Pune and make sure they attend", 1000.0)
print(f"[1] Contract Agent: source={c_out.source} ({time.time() - t0:.1f}s) | milestones={len(c_out.milestones)}")
assert c_out.source == "llm", f"Contract agent used fallback! {c_out.warnings}"

t1 = time.time()
img_bytes = make_visual_receipt_image("482915", 300.0)
v_out = verify_submission(
    milestone_title="Tuition Fee Disbursement",
    milestone_description="Pay school tuition fees for 30 girls.",
    tranche_amount=300.0,
    evidence_requirements=[
        "In-app photo or short video showing the one-time challenge code",
        "Official school payment receipt",
    ],
    expected_challenge_code="482915",
    files=[("receipt_photo.png", "image/png", img_bytes)],
)
print(
    f"[2] Verifier Agent: source={v_out.source} ({time.time() - t1:.1f}s) | "
    f"code_visible={v_out.challenge_code_visible} | observed={v_out.observed_challenge_code} | "
    f"receipt_amt={v_out.claimed_amount_on_receipt} | conf={v_out.confidence}"
)
assert v_out.source == "llm", "Verifier agent used fallback!"

t2 = time.time()
s_out = run_skeptic(
    milestone_title="Tuition Fee Disbursement",
    milestone_description="Pay school tuition fees for 30 girls.",
    tranche_amount=300.0,
    submission_flags=[],
    geo={"lat": 18.5204, "lng": 73.8567},
    verifier=v_out,
    similarity_hits=[],
    files=[("receipt_photo.png", "image/png", img_bytes)],
)
print(
    f"[3] Skeptic Agent: source={s_out.source} ({time.time() - t2:.1f}s) | "
    f"risk={s_out.fraud_risk} | rec={s_out.recommendation}"
)
assert s_out.source == "llm", "Skeptic agent used fallback!"

t3 = time.time()
rules = RuleEvaluation(
    all_passed=True,
    deterministic_outcome="release",
    checks={
        "project_funded": RuleCheck(passed=True, detail="Funded $1000"),
        "challenge_code_verified": RuleCheck(passed=True, detail="Code 482915 visible"),
        "skeptic_cleared": RuleCheck(passed=True, detail="Risk 0.05"),
        "independent_confirmation_met": RuleCheck(passed=True, detail="1 vendor confirmed"),
        "no_open_disputes": RuleCheck(passed=True, detail="No disputes"),
        "within_auto_approval_limit": RuleCheck(passed=True, detail="300 <= 500"),
    },
)
r_out = decide_release("Tuition Fee Disbursement", 300.0, rules)
print(
    f"[4] Release Agent: source={r_out.source} ({time.time() - t3:.1f}s) | "
    f"decision={r_out.decision} | explanation={r_out.explanation}"
)
assert r_out.source == "llm", "Release agent used fallback!"
print("ALL 4 AGENTS VERIFIED LIVE VIA GEMINI API!")
