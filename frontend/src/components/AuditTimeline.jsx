import React, { useMemo, useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Info,
  Search,
  UserCheck,
  Building2,
} from "lucide-react";
import { formatDateTime } from "../api.js";

const CATEGORIES = [
  "All",
  "PayPal Funding",
  "Field Evidence",
  "AI Verification",
  "Third-Party Proof",
  "Release Engine",
  "PayPal Payout",
  "Dispute",
  "Compliance Review",
];

function severityStyle(sev) {
  if (sev === "ok") {
    return {
      badge: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />,
    };
  }
  if (sev === "warn") {
    return {
      badge: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
      icon: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />,
    };
  }
  if (sev === "err") {
    return {
      badge: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
      icon: <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />,
    };
  }
  return {
    badge: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",
    icon: <Info className="w-4 h-4 text-sky-600 shrink-0" />,
  };
}

export default function AuditTimeline({ audit = [] }) {
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return audit.filter((row) => {
      if (category !== "All" && row.category !== category) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        (row.event_title || "").toLowerCase().includes(q) ||
        (row.summary || "").toLowerCase().includes(q) ||
        (row.actor_label || "").toLowerCase().includes(q) ||
        (row.entity_label || "").toLowerCase().includes(q)
      );
    });
  }, [audit, category, query]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Activity &amp; Security Audit Trail
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Human-readable chronological record of grant funding, field verification, third-party confirmations, and PayPal disbursements.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search events, actors, milestones..."
              className="pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 w-60"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="py-1.5 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c === "All" ? "All Categories" : c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500">
          No audit events match your filter.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto mt-2 pr-1">
          {filtered.map((item) => {
            const st = severityStyle(item.severity);
            return (
              <div
                key={item.id}
                className="py-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-3 hover:bg-slate-50/70 px-2 rounded-lg transition"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{st.icon}</div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {item.event_title || item.action}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${st.badge}`}
                      >
                        {item.category || "System"}
                      </span>
                      {item.entity_label && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700">
                          <Building2 className="w-3 h-3 text-slate-500" />
                          {item.entity_label}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700 mt-1">
                      {item.summary || item.details_json}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                      <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                      <span>Actor: <strong className="font-medium text-slate-700">{item.actor_label || item.actor}</strong></span>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-slate-400 whitespace-nowrap sm:text-right">
                  {formatDateTime(item.created_at)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
