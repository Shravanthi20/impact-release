import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  LogIn,
  LogOut,
  ArrowRight,
} from "lucide-react";
import {
  api,
  formatCurrency,
  getStoredUser,
  setAuthToken,
  setStoredUser,
} from "./api.js";
import LandingPage from "./components/LandingPage.jsx";
import DonorWorkspace from "./components/DonorWorkspace.jsx";
import NgoWorkspace from "./components/NgoWorkspace.jsx";
import VerifierWorkspace from "./components/VerifierWorkspace.jsx";
import AuditorWorkspace from "./components/AuditorWorkspace.jsx";
import PublicWorkspace from "./components/PublicWorkspace.jsx";
import AuthModal from "./components/AuthModal.jsx";

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalRole, setAuthModalRole] = useState("donor");

  const [health, setHealth] = useState(null);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [riskGraph, setRiskGraph] = useState({
    nodes: [],
    edges: [],
    alerts: [],
    edge_count: 0,
  });
  const [audit, setAudit] = useState([]);
  const [activeInvites, setActiveInvites] = useState([]);
  const [toast, setToast] = useState(null);

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
      notify(`Sync notice: ${err.message}`, "error");
    }
  }, [notify]);

  useEffect(() => {
    refreshAll();
    const params = new URLSearchParams(window.location.search);
    if (params.get("funded") === "true") {
      notify(
        "PayPal sandbox payment verified and escrow funds captured successfully!"
      );
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get("payment_cancelled") === "true") {
      notify("PayPal checkout was cancelled by user.", "error");
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get("payment_error")) {
      notify(`PayPal payment issue: ${params.get("payment_error")}`, "error");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [refreshAll, notify]);

  function handleLoginSuccess(user) {
    setCurrentUser(user);
    setShowAuthModal(false);
    notify(`Signed in as ${user.name}`);
    refreshAll();
  }

  function handleLogout() {
    setAuthToken("");
    setStoredUser(null);
    setCurrentUser(null);
    notify("Signed out");
  }

  function handleOpenAuth(role = "donor") {
    setAuthModalRole(role);
    setShowAuthModal(true);
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

  return (
    <div className="min-h-screen bg-warmgray-50 text-warmgray-900 flex flex-col font-sans">
      {/* Top Application Navbar */}
      <header className="bg-warmgray-950 text-warmgray-100 border-b border-warmgray-800 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Brand Logo & Name */}
          <button
            onClick={() => {
              if (currentUser) {
                // Stay on user's dashboard or refresh
                refreshAll();
              }
            }}
            className="flex items-center gap-3 text-left focus:outline-none cursor-pointer"
          >
            <div className="w-9 h-9 rounded-xl bg-forest-900/90 border border-forest-500/40 flex items-center justify-center text-forest-300 font-black text-sm shadow-inner font-serif">
              IR
            </div>
            <div>
              <span className="font-bold text-base tracking-tight text-white block font-serif">
                ImpactRelease
              </span>
              <span className="text-[11px] text-warmgray-400 block leading-none">
                Milestone Grant Escrow &amp; Verifiable Disbursements
              </span>
            </div>
          </button>

          {/* Right Action Navigation - Clean & Focused */}
          <div className="flex items-center gap-3">
            {currentUser ? (
              <div className="flex items-center gap-2 pl-3 border-l border-warmgray-800">
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-bold text-warmgray-200">
                    {currentUser.name}
                  </div>
                  <div className="text-[10px] text-forest-400 font-semibold uppercase tracking-wide">
                    {currentUser.role === "donor"
                      ? "Sponsor Dashboard"
                      : currentUser.role === "ngo"
                      ? "NGO Partner Dashboard"
                      : "Compliance Admin Console"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Sign Out"
                  className="p-1.5 rounded-lg bg-warmgray-900 hover:bg-terracotta-950 hover:text-terracotta-300 text-warmgray-400 transition cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenAuth("donor")}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-terracotta-600 hover:bg-terracotta-500 text-white transition shadow-sm cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  Sign In / Register
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Role context breadcrumb if authenticated */}
        {currentUser && (
          <div className="bg-warmgray-950/90 border-t border-warmgray-800/80 px-4 sm:px-6 lg:px-8 py-2">
            <div className="max-w-7xl mx-auto flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-warmgray-300">
                <span className="font-semibold text-terracotta-400 uppercase tracking-wider text-[10px]">
                  Workspace:
                </span>
                <span className="font-bold text-white">
                  {currentUser.role === "donor" && "Grant Portfolio & Milestone Contracting"}
                  {currentUser.role === "ngo" && "Field Deliverable Evidence & Tranche Releases"}
                  {currentUser.role === "reviewer" && "Compliance Audits, Fraud Quarantines & Risk Graph"}
                </span>
              </div>
              <button
                type="button"
                onClick={refreshAll}
                className="text-warmgray-400 hover:text-white inline-flex items-center gap-1 cursor-pointer text-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Sync Data</span>
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col">
        {/* Toast notification */}
        {toast && (
          <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-4">
            <div
              className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs font-medium shadow-sm animate-fade-in ${
                toast.type === "error"
                  ? "bg-rose-50 border-rose-200 text-rose-900"
                  : "bg-forest-50 border-forest-200 text-forest-950"
              }`}
            >
              <div className="flex items-center gap-2">
                {toast.type === "error" ? (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-forest-700 shrink-0" />
                )}
                <span>{toast.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="text-warmgray-500 hover:text-warmgray-800 font-semibold cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* View 1: Clean Landing Page for all unauthenticated visitors */}
        {!currentUser ? (
          <LandingPage onGetStarted={(role) => handleOpenAuth(role)} />
        ) : (
          /* View 2: Dedicated Role Dashboard for Authenticated User */
          <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
            {/* KPI Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-warmgray-200 rounded-2xl p-4 shadow-sm">
                <span className="text-xs font-semibold text-warmgray-500">
                  Active Grant Programs
                </span>
                <div className="text-2xl font-black text-warmgray-900 mt-1 font-serif">
                  {kpis.grants}
                </div>
                <span className="text-[11px] text-warmgray-500">
                  Milestone-escrowed contracts
                </span>
              </div>

              <div className="bg-white border border-warmgray-200 rounded-2xl p-4 shadow-sm">
                <span className="text-xs font-semibold text-warmgray-500">
                  Escrow Balance
                </span>
                <div className="text-2xl font-black text-warmgray-900 mt-1 font-serif">
                  {formatCurrency(kpis.funded)}
                </div>
                <span className="text-[11px] text-forest-700 font-semibold">
                  Protected &amp; ring-fenced
                </span>
              </div>

              <div className="bg-white border border-warmgray-200 rounded-2xl p-4 shadow-sm">
                <span className="text-xs font-semibold text-warmgray-500">
                  Disbursed Tranches
                </span>
                <div className="text-2xl font-black text-forest-700 mt-1 font-serif">
                  {formatCurrency(kpis.released)}
                </div>
                <span className="text-[11px] text-warmgray-500">
                  Released upon verified proof
                </span>
              </div>

              <div className="bg-white border border-warmgray-200 rounded-2xl p-4 shadow-sm">
                <span className="text-xs font-semibold text-warmgray-500">
                  Pending Compliance Reviews
                </span>
                <div
                  className={`text-2xl font-black mt-1 font-serif ${
                    kpis.quarantined > 0 ? "text-terracotta-700" : "text-warmgray-900"
                  }`}
                >
                  {kpis.quarantined}
                </div>
                <span className="text-[11px] text-warmgray-500">
                  Flagged or disputed tranches
                </span>
              </div>
            </div>

            {/* Render ONLY the dashboard matching the logged-in user's role */}
            {currentUser.role === "donor" && (
              <DonorWorkspace
                projects={projects}
                users={users}
                onRefresh={refreshAll}
                notify={notify}
              />
            )}

            {currentUser.role === "ngo" && (
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

            {currentUser.role === "reviewer" && (
              <AuditorWorkspace
                reviewQueue={reviewQueue}
                riskGraph={riskGraph}
                onRefresh={refreshAll}
                notify={notify}
              />
            )}
          </div>
        )}
      </main>

      {/* Authentication Modal */}
      {showAuthModal && (
        <AuthModal
          initialRole={authModalRole}
          onLoginSuccess={handleLoginSuccess}
          onClose={() => setShowAuthModal(false)}
        />
      )}
    </div>
  );
}
