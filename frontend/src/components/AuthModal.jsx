import React, { useState } from "react";
import {
  Lock,
  Mail,
  User,
  Building2,
  CreditCard,
  ArrowRight,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api, setAuthToken, setStoredUser } from "../api.js";

export default function AuthModal({ onLoginSuccess, onClose }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [role, setRole] = useState("donor"); // donor, ngo, reviewer
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const quickRoles = [
    {
      id: "donor",
      title: "Grant Sponsor",
      desc: "Fund programs & approve milestones",
      email: "donor@demo.impactrelease.org",
      name: "Asha Foundation",
    },
    {
      id: "ngo",
      title: "NGO Partner",
      desc: "Submit field proof & get tranches",
      email: "ngo@demo.impactrelease.org",
      name: "Vidya Grassroots Trust",
    },
    {
      id: "reviewer",
      title: "Compliance Admin",
      desc: "Audit claims & resolve fraud flags",
      email: "admin@demo.impactrelease.org",
      name: "Risk & Compliance Officer",
    },
  ];

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isSignUp) {
        const res = await api("/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role,
            name,
            email,
            password,
            organization_name: orgName,
            paypal_email: role === "ngo" ? paypalEmail : undefined,
          }),
        });
        setAuthToken(res.token);
        setStoredUser(res.user);
        onLoginSuccess(res.user);
      } else {
        const res = await api("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        setAuthToken(res.token);
        setStoredUser(res.user);
        onLoginSuccess(res.user);
      }
    } catch (err) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  function handleFillQuick(preset) {
    setRole(preset.id);
    setEmail(preset.email);
    setPassword("password123");
    setName(preset.name);
    setIsSignUp(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Modal Header */}
        <div className="bg-slate-900 text-white p-6 relative">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-400/40 flex items-center justify-center text-teal-300 font-bold">
              IR
            </div>
            <div>
              <h2 className="text-lg font-bold">
                {isSignUp ? "Create an Account" : "Sign in to ImpactRelease"}
              </h2>
              <p className="text-xs text-slate-400">
                AI-Verified Milestone Grants with PayPal Disbursements
              </p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-6 right-6 text-slate-400 hover:text-white text-sm"
            >
              ✕
            </button>
          )}
        </div>

        <div className="p-6 space-y-4">
          {/* Quick 1-Click Role Login Selector */}
          {!isSignUp && (
            <div className="space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                Quick Demo Credentials (1-Click Fill)
              </span>
              <div className="grid grid-cols-3 gap-2">
                {quickRoles.map((qr) => (
                  <button
                    key={qr.id}
                    type="button"
                    onClick={() => handleFillQuick(qr)}
                    className={`p-2.5 rounded-xl border text-left transition ${
                      role === qr.id && email === qr.email
                        ? "border-teal-600 bg-teal-50 ring-1 ring-teal-600"
                        : "border-slate-200 hover:border-slate-300 bg-slate-50/50"
                    }`}
                  >
                    <div className="font-bold text-xs text-slate-900 truncate">
                      {qr.title}
                    </div>
                    <div className="text-[10px] text-slate-500 line-clamp-1">
                      {qr.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {isSignUp && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Select Account Role
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setRole("donor")}
                      className={`p-2 rounded-lg text-xs font-semibold border ${
                        role === "donor"
                          ? "bg-teal-700 text-white border-teal-700"
                          : "bg-white text-slate-700 border-slate-300"
                      }`}
                    >
                      Sponsor / Donor
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole("ngo")}
                      className={`p-2 rounded-lg text-xs font-semibold border ${
                        role === "ngo"
                          ? "bg-teal-700 text-white border-teal-700"
                          : "bg-white text-slate-700 border-slate-300"
                      }`}
                    >
                      NGO Partner
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole("reviewer")}
                      className={`p-2 rounded-lg text-xs font-semibold border ${
                        role === "reviewer"
                          ? "bg-teal-700 text-white border-teal-700"
                          : "bg-white text-slate-700 border-slate-300"
                      }`}
                    >
                      Compliance Admin
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Contact Name
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Priya Sharma"
                      className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Organization Name
                    </label>
                    <input
                      type="text"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="e.g. Grassroots Trust"
                      className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>

                {role === "ngo" && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      PayPal Receiver Email (for Tranche Payouts)
                    </label>
                    <input
                      type="email"
                      required
                      value={paypalEmail}
                      onChange={(e) => setPaypalEmail(e.target.value)}
                      placeholder="ngo-sandbox@paypal.com"
                      className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                )}
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.org"
                  className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm transition shadow-sm disabled:opacity-50"
            >
              {loading ? (
                "Authenticating..."
              ) : isSignUp ? (
                "Create Account & Proceed"
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Toggle between Login and Signup */}
          <div className="pt-2 text-center text-xs text-slate-500 border-t border-slate-100">
            {isSignUp ? (
              <span>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setIsSignUp(false)}
                  className="text-teal-700 font-bold hover:underline"
                >
                  Sign in
                </button>
              </span>
            ) : (
              <span>
                Need a new organization account?{" "}
                <button
                  type="button"
                  onClick={() => setIsSignUp(true)}
                  className="text-teal-700 font-bold hover:underline"
                >
                  Sign up
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
