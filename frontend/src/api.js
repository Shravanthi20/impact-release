const API_BASE = import.meta.env.VITE_API_BASE || "";

export async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || `Request failed (${res.status})`);
  }
  return data;
}

export function formatCurrency(amount, currency = "USD") {
  const num = Number(amount || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(num);
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function statusBadgeClass(status) {
  const ok = [
    "FUNDED",
    "COMPLETED",
    "SETTLED",
    "VERIFIED",
    "APPROVED_FOR_RELEASE",
    "SUCCESS",
    "ANALYZED",
    "SUBMITTED",
  ];
  const warn = [
    "PENDING",
    "EVIDENCE_SUBMITTED",
    "CHALLENGE_WINDOW",
    "PAYOUT_SENT",
    "NEEDS_MORE_EVIDENCE",
  ];
  if (ok.includes(status)) {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20";
  }
  if (warn.includes(status)) {
    return "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20";
  }
  return "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20";
}
