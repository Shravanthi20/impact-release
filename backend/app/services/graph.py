"""Layer 5: Network collusion graph analysis across NGOs, devices, confirmers, and projects."""
import json
from collections import defaultdict
from typing import Any

from sqlmodel import Session, select

from app.db.models import Confirmation, Milestone, RiskGraphEdge, Submission


def record_submission_edges(session: Session, submission: Submission) -> None:
    dev = json.loads(submission.device_json or "{}")
    dev_id = dev.get("device_id") or dev.get("model")
    if dev_id:
        session.add(
            RiskGraphEdge(
                a_type="user",
                a_id=str(submission.submitted_by),
                b_type="device",
                b_id=str(dev_id)[:120],
                relation="submitted_from_device",
            )
        )


def record_confirmation_edges(session: Session, conf: Confirmation, milestone: Milestone) -> None:
    session.add(
        RiskGraphEdge(
            a_type="confirmer",
            a_id=f"{conf.kind}:{conf.contact_ref.lower()}",
            b_type="user",
            b_id=str(milestone.payee_user_id),
            relation="confirmed_for_payee",
        )
    )
    session.add(
        RiskGraphEdge(
            a_type="confirmer",
            a_id=f"{conf.kind}:{conf.contact_ref.lower()}",
            b_type="project",
            b_id=str(milestone.project_id),
            relation="confirmed_in_project",
        )
    )


def analyze_collusion_network(session: Session) -> dict[str, Any]:
    """Identify shared devices across distinct NGOs and repeat confirmers across projects."""
    edges = session.exec(select(RiskGraphEdge).order_by(RiskGraphEdge.id)).all()
    device_to_users: dict[str, set[str]] = defaultdict(set)
    confirmer_to_projects: dict[str, set[str]] = defaultdict(set)

    for e in edges:
        if e.relation == "submitted_from_device":
            device_to_users[e.b_id].add(e.a_id)
        elif e.relation == "confirmed_in_project":
            confirmer_to_projects[e.a_id].add(e.b_id)

    alerts: list[dict[str, Any]] = []
    for dev, users in device_to_users.items():
        if len(users) > 1:
            alerts.append({
                "code": "SHARED_DEVICE_ACROSS_NGOS",
                "entity": dev,
                "users": sorted(users),
                "detail": f"Device '{dev}' was used by {len(users)} different submitter accounts",
            })

    for conf_ref, projs in confirmer_to_projects.items():
        if len(projs) > 1:
            alerts.append({
                "code": "REPEAT_CONFIRMER_ACROSS_PROJECTS",
                "entity": conf_ref,
                "projects": sorted(projs),
                "detail": f"Confirmer '{conf_ref}' verified milestones across {len(projs)} projects",
            })

    return {
        "edge_count": len(edges),
        "alerts": alerts,
        "edges": [
            {
                "a": f"{e.a_type}:{e.a_id}",
                "b": f"{e.b_type}:{e.b_id}",
                "relation": e.relation,
            }
            for e in edges[:100]
        ],
    }
