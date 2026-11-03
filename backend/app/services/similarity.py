"""Perceptual hashing and cross-project duplicate/similarity search.

Works out-of-the-box with zero external services (local SQLite + 64-bit dHash perceptual hash +
token Jaccard over OCR text) and also supports Elasticsearch (`SIMILARITY_BACKEND=elastic`) when
`ELASTIC_URL` and `ELASTIC_API_KEY` are configured.
"""
import io
import logging
import re
from typing import Any

import httpx
from PIL import Image, UnidentifiedImageError
from sqlmodel import Session, select

from app.config import settings
from app.db.models import EvidenceItem, Milestone, Submission

logger = logging.getLogger(__name__)


def compute_phash(data: bytes) -> str | None:
    """Compute a 64-bit difference hash (dHash) as a 16-char hex string for an image.
    Returns None if ``data`` is not a readable image."""
    try:
        with Image.open(io.BytesIO(data)) as img:
            gray = img.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
            getter = getattr(gray, "get_flattened_data", gray.getdata)
            pixels = list(getter())
    except (UnidentifiedImageError, OSError, ValueError):
        return None
    bits = 0
    for row in range(8):
        offset = row * 9
        for col in range(8):
            bits = (bits << 1) | (1 if pixels[offset + col] > pixels[offset + col + 1] else 0)
    return f"{bits:016x}"


def hamming_distance(h1: str, h2: str) -> int:
    return (int(h1, 16) ^ int(h2, 16)).bit_count()


def _tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]{3,}", text.lower())}


def text_jaccard(t1: str, t2: str) -> float:
    a, b = _tokens(t1), _tokens(t2)
    if len(a) < 4 or len(b) < 4:
        return 0.0
    return len(a & b) / len(a | b)


def _elastic_enabled() -> bool:
    return settings.similarity_backend == "elastic" and bool(settings.elastic_url)


def _elastic_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if settings.elastic_api_key:
        headers["Authorization"] = f"ApiKey {settings.elastic_api_key}"
    return headers


def index_in_elastic(item: EvidenceItem, milestone_id: int, project_id: int) -> bool:
    """Index an evidence item in Elasticsearch when configured. Never raises on network failure."""
    if not _elastic_enabled():
        return False
    doc = {
        "evidence_id": item.id,
        "submission_id": item.submission_id,
        "milestone_id": milestone_id,
        "project_id": project_id,
        "filename": item.filename,
        "sha256": item.sha256,
        "phash": item.phash,
        "extracted_text": item.extracted_text,
    }
    url = f"{settings.elastic_url.rstrip('/')}/{settings.elastic_index}/_doc/{item.id}"
    try:
        r = httpx.put(url, json=doc, headers=_elastic_headers(), timeout=10)
        return r.status_code in (200, 201)
    except httpx.HTTPError as e:
        logger.warning("elastic index failed: %s", e)
        return False


def _query_elastic(item: EvidenceItem) -> list[dict[str, Any]]:
    if not _elastic_enabled():
        return []
    should: list[dict[str, Any]] = [{"term": {"sha256": item.sha256}}]
    if item.phash:
        should.append({"term": {"phash": item.phash}})
    if item.extracted_text and len(item.extracted_text.strip()) >= 20:
        should.append({"match": {"extracted_text": item.extracted_text}})
    query = {
        "size": 5,
        "query": {
            "bool": {
                "must_not": [{"term": {"submission_id": item.submission_id}}],
                "should": should,
                "minimum_should_match": 1,
            }
        },
    }
    url = f"{settings.elastic_url.rstrip('/')}/{settings.elastic_index}/_search"
    try:
        r = httpx.post(url, json=query, headers=_elastic_headers(), timeout=10)
        if r.status_code != 200:
            return []
        hits = []
        for h in r.json().get("hits", {}).get("hits", []):
            src = h.get("_source", {})
            hits.append({
                "kind": "ELASTIC_SIMILAR_EVIDENCE",
                "filename": item.filename,
                "earlier_submission_id": src.get("submission_id"),
                "earlier_milestone_id": src.get("milestone_id"),
                "score": h.get("_score", 1.0),
                "detail": f"Matched in Elastic against submission {src.get('submission_id')}",
            })
        return hits
    except httpx.HTTPError as e:
        logger.warning("elastic search failed: %s", e)
        return []


def find_similar_evidence(
    session: Session, submission: Submission, items: list[EvidenceItem]
) -> list[dict[str, Any]]:
    """Compare ``items`` against all earlier submissions across all projects."""
    prior_rows = session.exec(
        select(EvidenceItem, Submission, Milestone)
        .join(Submission, Submission.id == EvidenceItem.submission_id)
        .join(Milestone, Milestone.id == Submission.milestone_id)
        .where(EvidenceItem.submission_id != submission.id)
    ).all()

    hits: list[dict[str, Any]] = []
    seen_pairs: set[tuple[int | None, int | None, str]] = set()

    for item in items:
        for prior_item, prior_sub, prior_ms in prior_rows:
            if item.sha256 == prior_item.sha256:
                key = (item.id, prior_sub.id, "EXACT_FILE_DUPLICATE")
                if key not in seen_pairs:
                    seen_pairs.add(key)
                    hits.append({
                        "kind": "EXACT_FILE_DUPLICATE",
                        "filename": item.filename,
                        "earlier_submission_id": prior_sub.id,
                        "earlier_milestone_id": prior_ms.id,
                        "earlier_project_id": prior_ms.project_id,
                        "distance": 0,
                        "detail": (f"{item.filename} has identical SHA-256 to file in "
                                   f"submission #{prior_sub.id} (milestone #{prior_ms.id})"),
                    })
                continue

            if item.phash and prior_item.phash:
                dist = hamming_distance(item.phash, prior_item.phash)
                if dist <= settings.phash_hamming_threshold:
                    key = (item.id, prior_sub.id, "NEAR_DUPLICATE_IMAGE")
                    if key not in seen_pairs:
                        seen_pairs.add(key)
                        hits.append({
                            "kind": "NEAR_DUPLICATE_IMAGE",
                            "filename": item.filename,
                            "earlier_submission_id": prior_sub.id,
                            "earlier_milestone_id": prior_ms.id,
                            "earlier_project_id": prior_ms.project_id,
                            "distance": dist,
                            "detail": (f"{item.filename} is visually near-identical "
                                       f"(dHash distance {dist}/64) to {prior_item.filename} in "
                                       f"submission #{prior_sub.id}"),
                        })

            if item.extracted_text and prior_item.extracted_text:
                sim = text_jaccard(item.extracted_text, prior_item.extracted_text)
                if sim >= 0.75:
                    key = (item.id, prior_sub.id, "DUPLICATE_RECEIPT_TEXT")
                    if key not in seen_pairs:
                        seen_pairs.add(key)
                        hits.append({
                            "kind": "DUPLICATE_RECEIPT_TEXT",
                            "filename": item.filename,
                            "earlier_submission_id": prior_sub.id,
                            "earlier_milestone_id": prior_ms.id,
                            "earlier_project_id": prior_ms.project_id,
                            "similarity": round(sim, 2),
                            "detail": (f"Extracted receipt/document text in {item.filename} "
                                       f"overlaps ({int(sim * 100)}%) with submission #{prior_sub.id}"),
                        })

        for eh in _query_elastic(item):
            key = (item.id, eh.get("earlier_submission_id"), eh["kind"])
            if key not in seen_pairs:
                seen_pairs.add(key)
                hits.append(eh)

    return hits
