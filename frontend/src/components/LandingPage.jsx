import React from "react";
import {
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  CreditCard,
  HeartHandshake,
  Globe,
  Camera,
  Layers,
  Sprout,
  Droplets,
  HeartPulse,
} from "lucide-react";

export default function LandingPage({ onGetStarted, onExplorePublic }) {
  const causes = [
    {
      icon: "💧",
      title: "Clean Water Infrastructure",
      desc: "Tranches release as boreholes and solar pumps pass testing verified by local water councils.",
      badge: "Infrastructure",
    },
    {
      icon: "🏥",
      title: "Community Health & Surgeries",
      desc: "Disbursed upon hospital discharge notes, verified medication inventory, and doctor attestation.",
      badge: "Healthcare",
    },
    {
      icon: "🌊",
      title: "Disaster Emergency Relief",
      desc: "Unlocks immediate dry rations and water filtration kits directly to verified field distribution hubs.",
      badge: "Rapid Response",
    },
    {
      icon: "🌱",
      title: "Forestry & Native Planting",
      desc: "Funds released after geo-tagged seedling placement and periodic sapling survival tracking.",
      badge: "Ecology",
    },
    {
      icon: "📚",
      title: "Educational Access & Kits",
      desc: "Pay school fees, uniforms, and textbooks against verified vendor delivery receipts.",
      badge: "Education",
    },
    {
      icon: "🌾",
      title: "Sustainable Smallholder Farming",
      desc: "Escrowed capital for high-yield seeds and drip irrigation installed on community farmland.",
      badge: "Agriculture",
    },
  ];

  const pillars = [
    {
      step: "01",
      title: "State Intent in Human Words",
      desc: "A sponsor states what they wish to achieve. The system structures it into chronological, checkable tranches.",
      accent: "border-terracotta-500 text-terracotta-700 bg-terracotta-50",
    },
    {
      step: "02",
      title: "Ring-Fenced Escrow Balance",
      desc: "Capital is funded upfront into protected escrow. Grants cannot be prematurely drained or diverted.",
      accent: "border-forest-600 text-forest-700 bg-forest-50",
    },
    {
      step: "03",
      title: "In-App Proof & Perceptual Check",
      desc: "Field teams submit photos displaying a live one-time code. Perceptual hashing blocks duplicate or cropped receipts.",
      accent: "border-amber-600 text-amber-700 bg-amber-50",
    },
    {
      step: "04",
      title: "Independent Sign-Off & Release",
      desc: "Local suppliers and beneficiaries verify delivery via token links before the payout is triggered.",
      accent: "border-plum-600 text-plum-700 bg-plum-50",
    },
  ];

  return (
    <div className="bg-warmgray-50 min-h-screen text-warmgray-900 selection:bg-terracotta-200">
      {/* Editorial Hero with Warm Slate & Olive Tones */}
      <section className="relative overflow-hidden bg-gradient-to-b from-warmgray-950 via-warmgray-900 to-warmgray-900 text-warmgray-100 pt-20 pb-28 px-4 sm:px-6 lg:px-8 border-b border-warmgray-800">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,rgba(61,153,92,0.22),rgba(220,110,62,0.12),transparent)]"></div>
        
        <div className="max-w-5xl mx-auto text-center relative z-10 space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-forest-950/80 border border-forest-500/40 text-forest-300 text-xs font-semibold tracking-wide uppercase">
            <Sprout className="w-3.5 h-3.5 text-forest-400" />
            Accountable Philanthropy &amp; Grant Escrow
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight font-serif">
            Fund Any Humanitarian Cause with <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-terracotta-300 via-amber-200 to-forest-300 bg-clip-text text-transparent">
              Independent Proof of Work
            </span>
          </h1>

          <p className="max-w-2xl mx-auto text-base sm:text-lg text-warmgray-300 font-normal leading-relaxed">
            Eliminate blind upfront lump sums. Donors fund escrowed milestones, field teams upload authentic evidence with single-use challenge placards, and payments release only when suppliers and beneficiaries confirm delivery.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-4">
            <button
              onClick={() => onGetStarted("donor")}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-terracotta-600 hover:bg-terracotta-500 text-white font-bold text-sm transition shadow-md shadow-terracotta-900/30 cursor-pointer"
            >
              <span>Get Started as Sponsor</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => onGetStarted("ngo")}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-forest-800 hover:bg-forest-700 text-forest-100 font-bold text-sm border border-forest-700 transition cursor-pointer"
            >
              <span>Register as Field Partner</span>
            </button>
          </div>
        </div>
      </section>

      {/* Trust Guarantee Band */}
      <section className="bg-white border-b border-warmgray-200 py-6 px-4">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          <div>
            <div className="text-2xl font-black text-warmgray-900">100% Ring-Fenced</div>
            <div className="text-xs text-warmgray-500 font-medium mt-0.5">Disbursed strictly in verified tranches</div>
          </div>
          <div>
            <div className="text-2xl font-black text-forest-700">64-bit dHash</div>
            <div className="text-xs text-warmgray-500 font-medium mt-0.5">Catches cropped or duplicate invoices</div>
          </div>
          <div>
            <div className="text-2xl font-black text-terracotta-700">2-Way Witness</div>
            <div className="text-xs text-warmgray-500 font-medium mt-0.5">Supplier &amp; beneficiary confirmation</div>
          </div>
          <div>
            <div className="text-2xl font-black text-warmgray-800">10% Retention</div>
            <div className="text-xs text-warmgray-500 font-medium mt-0.5">Reserved until complete program closeout</div>
          </div>
        </div>
      </section>

      {/* The 4 Principles / Process */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <div className="text-center space-y-2 mb-12">
          <span className="text-xs font-bold uppercase tracking-wider text-forest-800 bg-forest-100 px-3 py-1 rounded-full border border-forest-200">
            Principled Architecture
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-warmgray-900 font-serif">
            How Grants Move from Intent to Verification
          </h2>
          <p className="text-sm text-warmgray-600 max-w-xl mx-auto">
            A transparent workflow designed so donors maintain certainty while legitimate field teams receive rapid payments.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {pillars.map((p, idx) => (
            <div
              key={idx}
              className="bg-white border border-warmgray-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition space-y-3.5 relative"
            >
              <div className="flex items-center justify-between">
                <span className="text-3xl font-black text-warmgray-300">
                  {p.step}
                </span>
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${p.accent}`}>
                  Phase {idx + 1}
                </span>
              </div>
              <h3 className="text-base font-bold text-warmgray-900">
                {p.title}
              </h3>
              <p className="text-xs text-warmgray-600 leading-relaxed">
                {p.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Causes Carousel / Grid */}
      <section className="bg-warmgray-100/70 border-y border-warmgray-200 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto space-y-10">
          <div className="text-center space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-terracotta-800 bg-terracotta-100 px-3 py-1 rounded-full border border-terracotta-200">
              Broad Impact Focus
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-warmgray-900 font-serif">
              Configured for Any Legitimate Aid Initiative
            </h2>
            <p className="text-sm text-warmgray-600 max-w-xl mx-auto">
              Regardless of the sector, milestone tranches provide concrete milestones that build enduring donor confidence.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {causes.map((c, i) => (
              <div
                key={i}
                className="bg-white border border-warmgray-200 rounded-xl p-5 shadow-sm space-y-2.5 hover:border-terracotta-400 transition"
              >
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{c.icon}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warmgray-100 text-warmgray-700">
                    {c.badge}
                  </span>
                </div>
                <h3 className="font-bold text-sm text-warmgray-900">{c.title}</h3>
                <p className="text-xs text-warmgray-600 leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer Banner */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto text-center space-y-6">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-warmgray-900 font-serif">
          Ready to Modernize Your Charitable Disbursals?
        </h2>
        <p className="text-sm text-warmgray-600 max-w-md mx-auto">
          Sign into your organization dashboard to sponsor new contracts, upload field proof, or inspect our live verification ledger.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => onGetStarted("donor")}
            className="px-6 py-3 rounded-xl bg-terracotta-600 hover:bg-terracotta-500 text-white font-bold text-sm shadow-sm transition cursor-pointer"
          >
            Open Sponsor Dashboard
          </button>
          <button
            onClick={() => onGetStarted("ngo")}
            className="px-6 py-3 rounded-xl bg-forest-800 hover:bg-forest-700 text-white font-bold text-sm shadow-sm transition cursor-pointer"
          >
            Open NGO Field Portal
          </button>
        </div>
      </section>
    </div>
  );
}
