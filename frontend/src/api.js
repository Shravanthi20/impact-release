const API_BASE = import.meta.env.VITE_API_BASE || "";

export function getAuthToken() {
  return localStorage.getItem("impactrelease_token") || "";
}

export function setAuthToken(token) {
  if (token) {
    localStorage.setItem("impactrelease_token", token);
  } else {
    localStorage.removeItem("impactrelease_token");
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem("impactrelease_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  if (user) {
    localStorage.setItem("impactrelease_user", JSON.stringify(user));
  } else {
    localStorage.removeItem("impactrelease_user");
  }
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getAuthToken();
  if (token && !headers["Authorization"]) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
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
