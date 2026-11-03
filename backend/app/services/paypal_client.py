"""PayPal client with two interchangeable implementations.

* ``StubPayPal``  - in-memory fake so the whole flow runs without credentials (tests, demos).
* ``SandboxPayPal`` - real PayPal REST calls against the sandbox.

Endpoints used (verify against current PayPal docs before relying on them):
  POST /v1/oauth2/token
  POST /v2/checkout/orders
  POST /v2/checkout/orders/{id}/capture
  POST /v1/payments/payouts
  POST /v1/notifications/verify-webhook-signature
"""
import uuid
from typing import Any, Protocol

import httpx

from app.config import settings


class PayPalError(Exception):
    pass


class PayPalClient(Protocol):
    def create_order(self, amount: float, currency: str, reference: str) -> dict[str, Any]: ...
    def capture_order(self, order_id: str) -> dict[str, Any]: ...
    def create_payout(
        self, sender_batch_id: str, receiver_email: str, amount: float, currency: str, note: str
    ) -> dict[str, Any]: ...
    def verify_webhook(self, headers: dict[str, str], body: dict[str, Any]) -> bool: ...


class StubPayPal:
    """Deterministic fake. Never contacts the network."""

    def __init__(self) -> None:
        self.orders: dict[str, dict[str, Any]] = {}
        self.payouts: dict[str, dict[str, Any]] = {}

    def create_order(self, amount, currency, reference):
        oid = "STUB-ORDER-" + uuid.uuid4().hex[:10].upper()
        self.orders[oid] = {"amount": amount, "currency": currency, "status": "CREATED"}
        return {"id": oid, "status": "CREATED",
                "approve_url": f"{settings.app_base_url}/stub/approve/{oid}"}

    def capture_order(self, order_id):
        order = self.orders.get(order_id)
        if not order:
            raise PayPalError("unknown order")
        order["status"] = "COMPLETED"
        return {"id": order_id, "status": "COMPLETED",
                "capture_id": "STUB-CAP-" + uuid.uuid4().hex[:10].upper()}

    def create_payout(self, sender_batch_id, receiver_email, amount, currency, note):
        # Idempotent on sender_batch_id, like PayPal.
        if sender_batch_id in self.payouts:
            return self.payouts[sender_batch_id]
        res = {"batch_id": "STUB-BATCH-" + uuid.uuid4().hex[:10].upper(),
               "batch_status": "PENDING", "sender_batch_id": sender_batch_id}
        self.payouts[sender_batch_id] = res
        return res

    def verify_webhook(self, headers, body):
        return True


class SandboxPayPal:
    def __init__(self) -> None:
        self._token: str | None = None

    def _client(self) -> httpx.Client:
        return httpx.Client(base_url=settings.paypal_base_url, timeout=20)

    def _auth(self) -> dict[str, str]:
        if not self._token:
            with self._client() as c:
                r = c.post("/v1/oauth2/token", data={"grant_type": "client_credentials"},
                           auth=(settings.paypal_client_id, settings.paypal_client_secret))
            if r.status_code != 200:
                raise PayPalError(f"auth failed: {r.status_code} {r.text}")
            self._token = r.json()["access_token"]
        return {"Authorization": f"Bearer {self._token}"}

    def _post(self, path: str, json: dict, request_id: str | None = None) -> dict:
        headers = {**self._auth(), "Content-Type": "application/json"}
        if request_id:
            headers["PayPal-Request-Id"] = request_id
        with self._client() as c:
            r = c.post(path, json=json, headers=headers)
        if r.status_code >= 400:
            raise PayPalError(f"{path} failed: {r.status_code} {r.text}")
        return r.json() if r.content else {}

    def create_order(self, amount, currency, reference):
        data = self._post("/v2/checkout/orders", {
            "intent": "CAPTURE",
            "purchase_units": [{"reference_id": reference,
                                "amount": {"currency_code": currency, "value": f"{amount:.2f}"}}],
            "payment_source": {"paypal": {"experience_context": {
                "return_url": f"{settings.app_base_url}/funding/return",
                "cancel_url": f"{settings.app_base_url}/funding/cancel"}}},
        }, request_id=f"order-{reference}")
        approve = next((l["href"] for l in data.get("links", [])
                        if l["rel"] in ("payer-action", "approve")), None)
        return {"id": data["id"], "status": data["status"], "approve_url": approve}

    def capture_order(self, order_id):
        data = self._post(f"/v2/checkout/orders/{order_id}/capture", {}, request_id=f"cap-{order_id}")
        cap = data["purchase_units"][0]["payments"]["captures"][0]["id"]
        return {"id": order_id, "status": data["status"], "capture_id": cap}

    def create_payout(self, sender_batch_id, receiver_email, amount, currency, note):
        data = self._post("/v1/payments/payouts", {
            "sender_batch_header": {"sender_batch_id": sender_batch_id,
                                    "email_subject": "ImpactRelease payout"},
            "items": [{"recipient_type": "EMAIL", "receiver": receiver_email, "note": note,
                       "sender_item_id": sender_batch_id,
                       "amount": {"value": f"{amount:.2f}", "currency": currency}}],
        })
        h = data["batch_header"]
        return {"batch_id": h["payout_batch_id"], "batch_status": h["batch_status"],
                "sender_batch_id": sender_batch_id}

    def verify_webhook(self, headers, body):
        h = {k.lower(): v for k, v in headers.items()}
        try:
            data = self._post("/v1/notifications/verify-webhook-signature", {
                "auth_algo": h["paypal-auth-algo"], "cert_url": h["paypal-cert-url"],
                "transmission_id": h["paypal-transmission-id"],
                "transmission_sig": h["paypal-transmission-sig"],
                "transmission_time": h["paypal-transmission-time"],
                "webhook_id": settings.paypal_webhook_id, "webhook_event": body})
        except (KeyError, PayPalError):
            return False
        return data.get("verification_status") == "SUCCESS"


_client: PayPalClient | None = None


def get_paypal() -> PayPalClient:
    global _client
    if _client is None:
        _client = SandboxPayPal() if settings.paypal_mode == "sandbox" else StubPayPal()
    return _client
