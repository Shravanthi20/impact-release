import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  Briefcase,
  Camera,
  UserCheck,
  Scale,
  Globe,
  Database,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { api, formatCurrency } from "./api.js";
import DonorWorkspace from "./components/DonorWorkspace.jsx";
import NgoWorkspace from "./components/NgoWorkspace.jsx";
import VerifierWorkspace from "./components/VerifierWorkspace.jsx";
import AuditorWorkspace from "./components/AuditorWorkspace.jsx";
import PublicWorkspace from "./components/PublicWorkspace.jsx";

const ROLES = [
  {
    id: "donor",
    label: "Donor Portal",
    persona: "Asha Foundation (Grantmaker)",
    badge: "Fund & Structure Grants",
    icon: Briefcase,
  },
  {
    id: "ngo",
    label: "NGO Field Partner",
    persona: "Vidya Grassroots Trust",
    badge: "Submit Proof & Request Payouts",
    icon: Camera,
  },
  {
    id: "verifier",
    label: "External Verifier",
    persona: "Vendor / School Principal",
    badge: "Confirm Delivery or Dispute",
    icon: UserCheck,
  },
  {
    id: "auditor",
    label: "Compliance Auditor",
    persona: "Risk & Audit Operations",
    badge: "Review Escalations & Collusion",
    icon: Scale,
  },
  {
    id: "public",
    label: "Public Transparency",
    persona: "Open Ledger & Audit Trail",
    badge: "Zero-PII Public Record",
    icon: Globe,
  },
];

export default function App() {
  const [activeRole, setActiveRole] = useState("donor");
  const [health, setHealth] = useState(null);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [riskGraph, setRiskGraph] = useState({
    nodes: [],
    edges: [],
    suspicious_clusters: [],
  });
  const [audit, setAudit] = useState([]);
  const [activeInvites, setActiveInvites] = useState([]);
  const [toast, setToast] = useState(null);
  const [seeding, setSeeding] = useState(false);

  const notify = useCallback((message, type = "info") => {
    setToast({ message, type, ts: Date.now() });
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [h, u, p, l, rq, rg, au] = await Promise.all([
        api("/health"),
        api("/users"),
        api("/projects"),
        api("/ledger/public"),
        api("/review/queue"),
        api("/graph/risk"),
        api("/audit"),
      ]);
      setHealth(h);
      setUsers(u);
      setProjects(p);
      setLedger(l);
      setReviewQueue(rq);
      setRiskGraph(rg);
      setAudit(au);
    } catch (err) {
      notify(`Failed to sync workspace state: ${err.message}`, "error");
    }
  }, [notify]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  async function handleSeedPortfolio() {
    setSeeding(true);
    try {
      notify("Initializing sample grant portfolio and verified milestone records...");
      await api("/demo/seed", { method: "POST" });
      await refreshAll();
      notify("Sample grant portfolio loaded across all role workspaces.");
    } catch (err) {
      notify(`Failed to seed sample portfolio: ${err.message}`, "error");
    } finally {
      setSeeding(false);
    }
  }

  const kpis = useMemo(() => {
    const totalFunded = projects.reduce((acc, p) => acc + (p.funded || 0), 0);
    const totalReleased = projects.reduce(
      (acc, p) => acc + (p.released || 0),
      0
    );
    return {
      grants: projects.length,
      funded: totalFunded,
      released: totalReleased,
      quarantined: reviewQueue.length,
    };
  }, [projects, reviewQueue]);

  const currentRoleMeta =
    ROLES.find((r) => r.id === activeRole) || ROLES[0];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Enterprise Header */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-teal-500/20 border border-teal-400/40 flex items-center justify-center text-teal-300 font-extrabold text-sm">
              IR
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight">
                  ImpactRelease
                </span>
                <span className="hidden sm:inline-block text-[11px] font-semibold px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30">
                  PayPal Orders &amp; Payouts + Gemini Multimodal Verification
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden md:block">
                Milestone-Based Grant Escrow, Anti-Fraud Field Verification &amp; Disbursement Platform
              </p>
            </div>
          </div>

          {/* Right controls: Role Switcher + Sample Portfolio Loader */}
          <div className="flex items-center gap-2.5">
            <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-300 bg-slate-800/90 px-3 py-1.5 rounded-lg border border-slate-700">
              <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
              <span>
                PayPal:{" "}
                <strong className="uppercase text-white">
                  {health?.paypal_mode || "sandbox"}
                </strong>
              </span>
              <span className="text-slate-600">|</span>
              <span>
                AI:{" "}
                <strong className="uppercase text-teal-300">
                  {health?.llm_provider || "gemini"}
                </strong>
              </span>
            </div>

            <button
              type="button"
              onClick={handleSeedPortfolio}
              disabled={seeding}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white transition shadow-sm disabled:opacity-50"
            >
              <Database className="w-3.5 h-3.5" />
              {seeding ? "Loading..." : "Load Sample Portfolio"}
            </button>

            <button
              type="button"
              onClick={refreshAll}
              title="Refresh Data"
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Role Navigation Bar */}
        <div className="bg-slate-950/60 border-t border-slate-800/80">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between overflow-x-auto py-2 gap-2">
            <div className="flex items-center gap-1.5">
              {ROLES.map((r) => {
                const Icon = r.icon;
                const active = activeRole === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setActiveRole(r.id)}
                    className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                      active
                        ? "bg-teal-600 text-white shadow-sm"
                        : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{r.label}</span>
                    {r.id === "auditor" && kpis.quarantined > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                        {kpis.quarantined}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 shrink-0">
              <span>Signed in as:</span>
              <strong className="text-slate-200 font-semibold">
                {currentRoleMeta.persona}
              </strong>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 space-y-6">
        {/* Toast notification */}
        {toast && (
          <div
            className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs font-medium shadow-sm ${
              toast.type === "error"
                ? "bg-rose-50 border-rose-200 text-rose-900"
                : "bg-teal-50/90 border-teal-200 text-teal-950"
            }`}
          >
            <div className="flex items-center gap-2">
              {toast.type === "error" ? (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
              )}
              <span>{toast.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-slate-500 hover:text-slate-800 font-semibold"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Executive KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <span className="text-xs font-semibold text-slate-500">
              Active Grant Contracts
            </span>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">
              {kpis.grants}
            </div>
            <span className="text-[11px] text-slate-500">
              Milestone-escrowed programs
            </span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <span className="text-xs font-semibold text-slate-500">
              Escrow Funded (PayPal Orders)
            </span>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">
              {formatCurrency(kpis.funded)}
            </div>
            <span className="text-[11px] text-emerald-700 font-medium">
              Captured &amp; ring-fenced
            </span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <span className="text-xs font-semibold text-slate-500">
              Verified &amp; Disbursed (PayPal Payouts)
            </span>
            <div className="text-2xl font-extrabold text-teal-700 mt-1">
              {formatCurrency(kpis.released)}
            </div>
            <span className="text-[11px] text-slate-500">
              Released on multi-party proof
            </span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <span className="text-xs font-semibold text-slate-500">
              Compliance Review Queue
            </span>
            <div
              className={`text-2xl font-extrabold mt-1 ${
                kpis.quarantined > 0 ? "text-rose-600" : "text-slate-900"
              }`}
            >
              {kpis.quarantined}
            </div>
            <span className="text-[11px] text-slate-500">
              Flagged or disputed tranches
            </span>
          </div>
        </div>

        {/* Active Role Workspace */}
        {activeRole === "donor" && (
          <DonorWorkspace
            projects={projects}
            users={users}
            onRefresh={refreshAll}
            notify={notify}
          />
        )}

        {activeRole === "ngo" && (
          <NgoWorkspace
            projects={projects}
            users={users}
            onRefresh={refreshAll}
            notify={notify}
            onInviteCreated={(newInvites) =>
              setActiveInvites((prev) => [...newInvites, ...prev])
            }
          />
        )}

        {activeRole === "verifier" && (
          <VerifierWorkspace
            projects={projects}
            activeInvites={activeInvites}
            onInviteCreated={(newInvites) =>
              setActiveInvites((prev) => [...newInvites, ...prev])
            }
            onRefresh={refreshAll}
            notify={notify}
          />
        )}

        {activeRole === "auditor" && (
          <AuditorWorkspace
            reviewQueue={reviewQueue}
            riskGraph={riskGraph}
            onRefresh={refreshAll}
            notify={notify}
          />
        )}

        {activeRole === "public" && (
          <PublicWorkspace ledger={ledger} audit={audit} />
        )}
      </main>
    </div>
  );
}
