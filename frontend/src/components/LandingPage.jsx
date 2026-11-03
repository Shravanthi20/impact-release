import React from "react";
import {
  ShieldCheck,
  CheckCircle2,
  Lock,
  ArrowRight,
  Sparkles,
  Building2,
  Users,
  Eye,
  FileCheck2,
  CreditCard,
  HeartHandshake,
  TrendingUp,
  Globe,
  Camera,
} from "lucide-react";

export default function LandingPage({ onGetStarted, onExplorePublic }) {
  const causes = [
    {
      icon: "💧",
      title: "Clean Water & Wells",
      desc: "Release funds as solar pumps and pipes are verified by village water committees.",
    },
    {
      icon: "🏥",
      title: "Medical Camps & Surgeries",
      desc: "Tranches disburse upon doctor sign-offs and patient recovery verification.",
    },
    {
      icon: "🌊",
      title: "Disaster Emergency Relief",
      desc: "Release food and survival kits to verified distribution points in flood zones.",
    },
    {
      icon: "🌱",
      title: "Reforestation & Climate",
      desc: "Funds unlocked after tree planting and quarterly sapling survival monitoring.",
    },
    {
      icon: "📚",
      title: "Education & Schools",
      desc: "Pay school tuition and supplies against genuine verified vendor invoices.",
    },
    {
      icon: "🍲",
      title: "Community Food Security",
      desc: "Escrowed grants for soup kitchens and dry ration distribution networks.",
    },
  ];

  const steps = [
    {
      step: "01",
      title: "Define Objective in Plain Words",
      desc: "A sponsor states what they want to fund. Our AI turns it into measurable, checkable tranches with clear verification rules.",
      icon: Sparkles,
    },
    {
      step: "02",
      title: "Escrow Funding via PayPal",
      desc: "Grant capital is safely ring-fenced upfront via PayPal Orders. Funds stay protected until each stage is completed.",
      icon: CreditCard,
    },
    {
      step: "03",
      title: "Field Proof & Multimodal AI",
      desc: "NGO teams upload real proof with a one-time 6-digit challenge code. Perceptual hashing blocks duplicate or cropped receipts.",
      icon: Camera,
    },
    {
      step: "04",
      title: "Independent Attestation & Release",
      desc: "Local suppliers and beneficiaries confirm delivery via magic links. Once 6 hard safety rules pass, PayPal disburses the tranche.",
      icon: HeartHandshake,
    },
  ];

  return (
    <div className="bg-slate-50 min-h-screen text-slate-900">
      {/* Hero Section with Vibrant Background */}
      <section className="relative overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-900 text-white pt-16 pb-24 px-4 sm:px-6 lg:px-8 border-b border-slate-800">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(20,184,166,0.25),rgba(255,255,255,0))]"></div>
        <div className="max-w-5xl mx-auto text-center relative z-10 space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/30 text-teal-300 text-xs font-semibold tracking-wide uppercase">
            <ShieldCheck className="w-4 h-4 text-teal-400" />
            Milestone-Verified Charitable Grant Escrow
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight">
            Fund Any Cause with <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-teal-300 via-emerald-400 to-cyan-300 bg-clip-text text-transparent">
              Guaranteed Proof of Impact
            </span>
          </h1>

          <p className="max-w-2xl mx-auto text-base sm:text-lg text-slate-300 font-normal leading-relaxed">
            Eliminate blind lump-sum grants. Donors state an objective, AI creates verifiable milestone contracts, and tranches release via PayPal only when field evidence and independent beneficiaries confirm the work is real.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <button
              onClick={() => onGetStarted("donor")}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm transition shadow-lg shadow-teal-500/25 cursor-pointer"
            >
              <span>Get Started as Sponsor</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => onGetStarted("ngo")}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm border border-slate-700 transition cursor-pointer"
            >
              <span>Register as NGO Partner</span>
            </button>
            <button
              onClick={onExplorePublic}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-transparent hover:bg-slate-800/60 text-slate-300 font-semibold text-sm border border-slate-700/60 transition cursor-pointer"
            >
              <Globe className="w-4 h-4 text-teal-400" />
              <span>Explore Public Ledger</span>
            </button>
          </div>
        </div>
      </section>

      {/* Trust Stats Bar */}
      <section className="bg-white border-b border-slate-200 py-6 px-4">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          <div>
            <div className="text-2xl font-black text-slate-900">100%</div>
            <div className="text-xs text-slate-500 font-medium mt-0.5">Escrow Ring-Fenced</div>
          </div>
          <div>
            <div className="text-2xl font-black text-teal-700">0 Reused Bills</div>
            <div className="text-xs text-slate-500 font-medium mt-0.5">Perceptual dHash Blocked</div>
          </div>
          <div>
            <div className="text-2xl font-black text-emerald-700">2-Way</div>
            <div className="text-xs text-slate-500 font-medium mt-0.5">Vendor &amp; Beneficiary Proof</div>
          </div>
          <div>
            <div className="text-2xl font-black text-slate-900">Instant</div>
            <div className="text-xs text-slate-500 font-medium mt-0.5">PayPal Payout Disbursals</div>
          </div>
        </div>
      </section>

      {/* How it Works Section */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <div className="text-center space-y-2 mb-12">
          <span className="text-xs font-bold uppercase tracking-wider text-teal-700 bg-teal-50 px-3 py-1 rounded-full border border-teal-200">
            Automated Accountability
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
            How ImpactRelease Works
          </h2>
          <p className="text-sm text-slate-600 max-w-xl mx-auto">
            From funding to field proof to beneficiary sign-off in 4 transparent stages.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((s, idx) => {
            const Icon = s.icon;
            return (
              <div
                key={idx}
                className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition space-y-3 relative group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-3xl font-black text-slate-200 group-hover:text-teal-200 transition">
                    {s.step}
                  </span>
                  <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </div>
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  {s.title}
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {s.desc}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Versatile Causes Section */}
      <section className="bg-slate-100/70 border-y border-slate-200 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto space-y-10">
          <div className="text-center space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-teal-700 bg-white px-3 py-1 rounded-full border border-slate-200">
              Universal Application
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
              Built for Every Charitable Cause
            </h2>
            <p className="text-sm text-slate-600 max-w-xl mx-auto">
              Any humanitarian initiative can be broken down into measurable, verified milestones.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {causes.map((c, i) => (
              <div
                key={i}
                className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-2 hover:border-teal-500/50 transition"
              >
                <div className="text-2xl">{c.icon}</div>
                <h3 className="font-bold text-sm text-slate-900">{c.title}</h3>
                <p className="text-xs text-slate-600 leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Footer */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto text-center space-y-6">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
          Ready to Start Verifiable Grant Programs?
        </h2>
        <p className="text-sm text-slate-600 max-w-lg mx-auto">
          Sign in or create your organization account to fund grants, submit field evidence, or audit disbursements.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => onGetStarted("donor")}
            className="px-6 py-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-sm shadow-sm transition"
          >
            Create Sponsor Account
          </button>
          <button
            onClick={() => onGetStarted("ngo")}
            className="px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm shadow-sm transition"
          >
            Create NGO Partner Account
          </button>
        </div>
      </section>
    </div>
  );
}
