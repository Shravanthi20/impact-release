import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  Briefcase,
  Camera,
  UserCheck,
  Scale,
  Globe,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  LogIn,
  LogOut,
  User,
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
  const [viewingPublicPortal, setViewingPublicPortal] = useState(false);
  const [viewingVerifierPortal, setViewingVerifierPortal] = useState(false);

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
  }, [refreshAll]);

  function handleLoginSuccess(user) {
    setCurrentUser(user);
    setShowAuthModal(false);
    setViewingPublicPortal(false);
    setViewingVerifierPortal(false);
    notify(`Signed in as ${user.name}`);
    refreshAll();
  }

  function handleLogout() {
    setAuthToken("");
    setStoredUser(null);
    setCurrentUser(null);
    setViewingPublicPortal(false);
    setViewingVerifierPortal(false);
    notify("Signed out");
  }

  function handleOpenAuth(role = "donor") {
    setAuthModalRole(role);
    setShowAuthModal(true);
  }

  // Determine current active view:
  // If not logged in and not exploring public or verifier, show Landing Page.
  const isLandingView = !currentUser && !viewingPublicPortal && !viewingVerifierPortal;

  // KPIs for the logged in user's role
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
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Application Navbar */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Brand Logo & Name */}
          <button
            onClick={() => {
              setViewingPublicPortal(false);
              setViewingVerifierPortal(false);
            }}
            className="flex items-center gap-3 text-left focus:outline-none cursor-pointer"
          >
            <div className="w-9 h-9 rounded-xl bg-teal-500/20 border border-teal-400/40 flex items-center justify-center text-teal-300 font-extrabold text-sm shadow-inner">
              IR
            </div>
            <div>
              <span className="font-bold text-base tracking-tight text-white block">
                ImpactRelease
              </span>
              <span className="text-[11px] text-slate-400 block leading-none">
                Milestone Grant Escrow &amp; Verifiable Disbursements
              </span>
            </div>
          </button>

          {/* Right Action Navigation */}
          <div className="flex items-center gap-3">
            {/* Quick Public Portal & Verifier Links */}
            <button
              onClick={() => {
                setViewingPublicPortal(true);
                setViewingVerifierPortal(false);
              }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer ${
                viewingPublicPortal
                  ? "bg-slate-800 text-teal-300 ring-1 ring-teal-500/40"
                  : "text-slate-300 hover:text-white hover:bg-slate-800"
              }`}
            >
              Public Transparency
            </button>

            <button
              onClick={() => {
                setViewingVerifierPortal(true);
                setViewingPublicPortal(false);
              }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer ${
                viewingVerifierPortal
                  ? "bg-slate-800 text-teal-300 ring-1 ring-teal-500/40"
                  : "text-slate-300 hover:text-white hover:bg-slate-800"
              }`}
            >
              Verifier Sign-Off
            </button>

            {/* Authenticated User Status or Sign-In Trigger */}
            {currentUser ? (
              <div className="flex items-center gap-2 pl-3 border-l border-slate-700">
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-bold text-slate-200">
                    {currentUser.name}
                  </div>
                  <div className="text-[10px] text-teal-400 font-semibold uppercase tracking-wide">
                    {currentUser.role === "donor"
                      ? "Grant Sponsor"
                      : currentUser.role === "ngo"
                      ? "NGO Partner"
                      : "Compliance Admin"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Sign Out"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-400 transition cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 pl-2">
                <button
                  type="button"
                  onClick={() => handleOpenAuth("donor")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-teal-500 hover:bg-teal-400 text-slate-950 transition shadow-sm cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  Sign In
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Role context breadcrumb if authenticated */}
        {currentUser && !viewingPublicPortal && !viewingVerifierPortal && (
          <div className="bg-slate-950/70 border-t border-slate-800/80 px-4 sm:px-6 lg:px-8 py-2">
            <div className="max-w-7xl mx-auto flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-300">
                <span className="font-semibold text-teal-400 uppercase tracking-wider text-[10px]">
                  Active Workspace:
                </span>
                <span className="font-bold text-white">
                  {currentUser.role === "donor" && "Sponsor Grant Portfolio & Milestone Contracts"}
                  {currentUser.role === "ngo" && "NGO Field Delivery, Invoices & PayPal Tranche Payouts"}
                  {currentUser.role === "reviewer" && "Admin Review, Fraud Quarantine & Collusion Graph"}
                </span>
              </div>
              <button
                type="button"
                onClick={refreshAll}
                className="text-slate-400 hover:text-white inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh Data</span>
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
                  : "bg-teal-50 border-teal-200 text-teal-950"
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
                className="text-slate-500 hover:text-slate-800 font-semibold cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* View 1: Landing Page (For Unauthenticated Visitors) */}
        {isLandingView && (
          <LandingPage
            onGetStarted={(role) => handleOpenAuth(role)}
            onExplorePublic={() => setViewingPublicPortal(true)}
          />
        )}

        {/* View 2: Public Transparency Portal */}
        {viewingPublicPortal && (
          <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  Public Transparency &amp; Proof-of-Impact Portal
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Real-time cryptographic audit log and settled PayPal milestone payouts open to all stakeholders.
                </p>
              </div>
              <button
                onClick={() => setViewingPublicPortal(false)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 transition cursor-pointer"
              >
                ← Back
              </button>
            </div>
            <PublicWorkspace ledger={ledger} audit={audit} />
          </div>
        )}

        {/* View 3: External Verifier / Beneficiary Attestation Portal */}
        {viewingVerifierPortal && (
          <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  External Field Verifier &amp; Beneficiary Sign-Off
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Confirm receipt of goods/services using magic tokens, or file an unfulfilled work dispute.
                </p>
              </div>
              <button
                onClick={() => setViewingVerifierPortal(false)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 transition cursor-pointer"
              >
                ← Back
              </button>
            </div>
            <VerifierWorkspace
              projects={projects}
              activeInvites={activeInvites}
              onInviteCreated={(newInvites) =>
                setActiveInvites((prev) => [...newInvites, ...prev])
              }
              onRefresh={refreshAll}
              notify={notify}
            />
          </div>
        )}

        {/* View 4: Authenticated Role-Specific Dashboards */}
        {currentUser && !viewingPublicPortal && !viewingVerifierPortal && (
          <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
            {/* Executive KPI Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <span className="text-xs font-semibold text-slate-500">
                  Active Grant Programs
                </span>
                <div className="text-2xl font-extrabold text-slate-900 mt-1">
                  {kpis.grants}
                </div>
                <span className="text-[11px] text-slate-500">
                  Milestone-escrowed contracts
                </span>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <span className="text-xs font-semibold text-slate-500">
                  Escrow Balance (PayPal Orders)
                </span>
                <div className="text-2xl font-extrabold text-slate-900 mt-1">
                  {formatCurrency(kpis.funded)}
                </div>
                <span className="text-[11px] text-emerald-700 font-medium">
                  Protected &amp; ring-fenced
                </span>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <span className="text-xs font-semibold text-slate-500">
                  Disbursed (PayPal Payouts)
                </span>
                <div className="text-2xl font-extrabold text-teal-700 mt-1">
                  {formatCurrency(kpis.released)}
                </div>
                <span className="text-[11px] text-slate-500">
                  Released upon verified proof
                </span>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <span className="text-xs font-semibold text-slate-500">
                  Pending Audit Reviews
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

            {/* Dedicated Role Dashboard */}
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
