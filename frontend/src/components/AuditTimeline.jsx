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
      badge: "bg-forest-100 text-forest-800 ring-1 ring-forest-600/20",
      icon: <CheckCircle2 className="w-4 h-4 text-forest-700 shrink-0" />,
    };
  }
  if (sev === "warn") {
    return {
      badge: "bg-amber-100 text-amber-900 ring-1 ring-amber-600/20",
      icon: <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />,
    };
  }
  if (sev === "err") {
    return {
      badge: "bg-terracotta-100 text-terracotta-800 ring-1 ring-terracotta-600/20",
      icon: <ShieldAlert className="w-4 h-4 text-terracotta-700 shrink-0" />,
    };
  }
  return {
    badge: "bg-warmgray-100 text-warmgray-700 ring-1 ring-warmgray-600/20",
    icon: <Info className="w-4 h-4 text-warmgray-600 shrink-0" />,
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
    <div className="bg-white border border-warmgray-200 rounded-2xl shadow-sm p-5 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-warmgray-100">
        <div>
          <h3 className="text-sm font-bold text-warmgray-900 font-serif">
            Activity &amp; Forensic Audit Trail
          </h3>
          <p className="text-xs text-warmgray-500 mt-0.5">
            Chronological cryptographic log of escrow deposits, challenge codes, AI checks, and releases.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-warmgray-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search audit trail..."
              className="pl-8 pr-3 py-1.5 text-xs border border-warmgray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-forest-600 w-52"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="py-1.5 px-3 text-xs border border-warmgray-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-forest-600 cursor-pointer"
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
        <div className="py-8 text-center text-xs text-warmgray-500">
          No audit records match your search filter.
        </div>
      ) : (
        <div className="divide-y divide-warmgray-100 max-h-[420px] overflow-y-auto pr-1">
          {filtered.map((item) => {
            const st = severityStyle(item.severity);
            return (
              <div
                key={item.id}
                className="py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3 hover:bg-warmgray-50/70 px-2 rounded-xl transition"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{st.icon}</div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-warmgray-900">
                        {item.event_title || item.action}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.badge}`}
                      >
                        {item.category || "System"}
                      </span>
                      {item.entity_label && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-warmgray-100 text-warmgray-700">
                          <Building2 className="w-3 h-3 text-warmgray-500" />
                          {item.entity_label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-warmgray-700 mt-1">
                      {item.summary || item.details_json}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-warmgray-500">
                      <UserCheck className="w-3.5 h-3.5 text-warmgray-400" />
                      <span>By: <strong className="font-semibold text-warmgray-800">{item.actor_label || item.actor}</strong></span>
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-warmgray-400 whitespace-nowrap sm:text-right shrink-0">
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
