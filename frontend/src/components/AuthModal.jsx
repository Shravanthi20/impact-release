import React, { useState } from "react";
import {
  Lock,
  Mail,
  User,
  Building2,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { api, setAuthToken, setStoredUser } from "../api.js";

export default function AuthModal({ initialRole = "donor", onLoginSuccess, onClose }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [role, setRole] = useState(initialRole);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-warmgray-950/75 backdrop-blur-sm animate-fade-in">
      <div className="bg-white border border-warmgray-200 rounded-3xl shadow-2xl max-w-md w-full overflow-hidden">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-warmgray-950 via-warmgray-900 to-warmgray-900 text-white p-6 relative">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-forest-900 border border-forest-500/40 flex items-center justify-center text-forest-300 font-bold text-sm">
              IR
            </div>
            <div>
              <h2 className="text-base font-bold font-serif">
                {isSignUp ? "Create an Account" : "Sign In to Your Account"}
              </h2>
              <p className="text-xs text-warmgray-400">
                Milestone Grant Escrow &amp; Verifiable Disbursements
              </p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-6 right-6 text-warmgray-400 hover:text-white text-base cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-warmgray-700 mb-1.5">
                Account Role
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setRole("donor")}
                  className={`p-2 rounded-xl text-xs font-semibold border cursor-pointer transition ${
                    role === "donor"
                      ? "bg-terracotta-700 text-white border-terracotta-700 shadow-sm"
                      : "bg-white text-warmgray-700 border-warmgray-300 hover:bg-warmgray-50"
                  }`}
                >
                  Sponsor
                </button>
                <button
                  type="button"
                  onClick={() => setRole("ngo")}
                  className={`p-2 rounded-xl text-xs font-semibold border cursor-pointer transition ${
                    role === "ngo"
                      ? "bg-forest-700 text-white border-forest-700 shadow-sm"
                      : "bg-white text-warmgray-700 border-warmgray-300 hover:bg-warmgray-50"
                  }`}
                >
                  NGO Partner
                </button>
                <button
                  type="button"
                  onClick={() => setRole("reviewer")}
                  className={`p-2 rounded-xl text-xs font-semibold border cursor-pointer transition ${
                    role === "reviewer"
                      ? "bg-plum-700 text-white border-plum-700 shadow-sm"
                      : "bg-white text-warmgray-700 border-warmgray-300 hover:bg-warmgray-50"
                  }`}
                >
                  Admin
                </button>
              </div>
            </div>

            {isSignUp && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-warmgray-700 mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jane Doe"
                      className="w-full text-xs px-3 py-2 border border-warmgray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-forest-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-warmgray-700 mb-1">
                      Organization
                    </label>
                    <input
                      type="text"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Organization Name"
                      className="w-full text-xs px-3 py-2 border border-warmgray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-forest-600"
                    />
                  </div>
                </div>

                {role === "ngo" && (
                  <div>
                    <label className="block text-xs font-semibold text-warmgray-700 mb-1">
                      PayPal Receiver Email (for Tranche Payouts)
                    </label>
                    <input
                      type="email"
                      required
                      value={paypalEmail}
                      onChange={(e) => setPaypalEmail(e.target.value)}
                      placeholder="payouts@organization.org"
                      className="w-full text-xs px-3 py-2 border border-warmgray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-forest-600"
                    />
                  </div>
                )}
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-warmgray-700 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-warmgray-400 absolute left-3 top-2.5" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@domain.org"
                  className="w-full text-xs pl-9 pr-3 py-2 border border-warmgray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-forest-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-warmgray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-warmgray-400 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full text-xs pl-9 pr-3 py-2 border border-warmgray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-forest-600"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-warmgray-900 hover:bg-warmgray-800 text-white font-bold text-xs transition shadow-sm disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                "Processing..."
              ) : isSignUp ? (
                "Register Account"
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="pt-2 text-center text-xs text-warmgray-500 border-t border-warmgray-100">
            {isSignUp ? (
              <span>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setIsSignUp(false)}
                  className="text-forest-700 font-bold hover:underline cursor-pointer"
                >
                  Sign in
                </button>
              </span>
            ) : (
              <span>
                Don't have an account yet?{" "}
                <button
                  type="button"
                  onClick={() => setIsSignUp(true)}
                  className="text-forest-700 font-bold hover:underline cursor-pointer"
                >
                  Create one now
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
