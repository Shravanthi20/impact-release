import React, { useState } from "react";
import {
  Sparkles,
  CreditCard,
  FolderKanban,
  CheckCircle2,
  AlertCircle,
  Lock,
  ArrowRight,
} from "lucide-react";
import { api, formatCurrency, statusBadgeClass } from "../api.js";

export default function DonorWorkspace({
  projects = [],
  users = [],
  onRefresh,
  notify,
}) {
  const [subTab, setSubTab] = useState("portfolio");
  const [selectedProjectId, setSelectedProjectId] = useState(
    projects[0]?.project?.id || ""
  );

  // New Grant Form
  const [intentText, setIntentText] = useState(
    "Construct a community solar water pump and distribution piping for 200 households in drought-affected drylands"
  );
  const [budget, setBudget] = useState(1000);
  const [holdbackPct, setHoldbackPct] = useState(10);
  const [draft, setDraft] = useState(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [fundingGrant, setFundingGrant] = useState(false);

  const activeProject =
    projects.find((p) => p.project.id === Number(selectedProjectId)) ||
    projects[0];

  async function handleStructureContract(e) {
    e.preventDefault();
    setLoadingDraft(true);
    try {
      notify("Structuring milestone contract via Gemini Contract Agent...");
      const res = await api("/projects/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent_text: intentText,
          budget: Number(budget),
          currency: "USD",
          holdback_pct: Number(holdbackPct),
        }),
      });
      setDraft(res);
      notify("Milestone schedule drafted. Review and approve to fund via PayPal.");
    } catch (err) {
      notify(`Could not draft contract: ${err.message}`, "error");
    } finally {
      setLoadingDraft(false);
    }
  }

  async function handleApproveAndFund() {
    if (!draft) return;
    setFundingGrant(true);
    try {
      let currentUsers = users;
      if (!currentUsers.length) {
        await api("/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "donor",
            name: "Asha Foundation",
            email: "donor@ashafoundation.org",
          }),
        });
        await api("/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "ngo",
            name: "Vidya Grassroots Trust",
            email: "ngo@vidyatrust.org",
            paypal_email: "vidya-ngo@sandbox.paypal.com",
          }),
        });
        currentUsers = await api("/users");
      }
      const donor =
        currentUsers.find((u) => u.role === "donor") || currentUsers[0];
      const ngo =
        currentUsers.find((u) => u.role === "ngo") ||
        currentUsers[currentUsers.length - 1];

      const created = await api("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          donor_id: donor.id,
          org_id: ngo.id,
          intent_text: intentText,
          total_amount: draft.budget,
          currency: draft.currency,
          holdback_pct: draft.holdback_pct,
          milestones: draft.milestones.map((m) => ({
            title: m.title,
            description: m.description,
            tranche_amount: m.tranche_amount,
            payee_user_id: ngo.id,
            evidence_requirements: m.evidence_requirements,
          })),
        }),
      });
      const pid = created.project.id;
      await api(`/projects/${pid}/fund`, { method: "POST" });
      await api(`/projects/${pid}/fund/capture`, { method: "POST" });
      setDraft(null);
      setSelectedProjectId(pid);
      setSubTab("portfolio");
      await onRefresh();
      notify(`Grant #${pid} approved and funded via PayPal Orders API!`);
    } catch (err) {
      notify(`Funding failed: ${err.message}`, "error");
    } finally {
      setFundingGrant(false);
    }
  }

  async function handleReleaseHoldback(projectId) {
    try {
      const payout = await api(`/projects/${projectId}/release-holdback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "Asha Foundation (Donor)" }),
      });
      await onRefresh();
      notify(
        `Final retention holdback (${formatCurrency(payout.amount)}) released via PayPal Payouts!`
      );
    } catch (err) {
      notify(`Holdback release blocked: ${err.message}`, "error");
    }
  }

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setSubTab("portfolio")}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
            subTab === "portfolio"
              ? "bg-teal-700 text-white shadow-sm"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          <FolderKanban className="w-4 h-4" />
          Grant Portfolio ({projects.length})
        </button>
        <button
          onClick={() => setSubTab("create")}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
            subTab === "create"
              ? "bg-teal-700 text-white shadow-sm"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Create &amp; Fund New Grant
        </button>
      </div>

      {subTab === "portfolio" ? (
        !activeProject ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
            <p className="text-slate-600 font-medium">
              No active grants in your portfolio yet.
            </p>
            <p className="text-sm text-slate-500 mt-1">
              Click <strong>Create &amp; Fund New Grant</strong> above or load the sample portfolio from the top bar.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left column: Grant list */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 h-fit">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
                Your Funded Grants
              </h3>
              {projects.map((entry) => {
                const p = entry.project;
                const isSelected = p.id === activeProject.project.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProjectId(p.id)}
                    className={`w-full text-left p-3.5 rounded-xl border transition ${
                      isSelected
                        ? "border-teal-600 bg-teal-50/40 ring-1 ring-teal-600"
                        : "border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        Grant #{p.id}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-xs font-semibold ${statusBadgeClass(
                          p.status
                        )}`}
                      >
                        {p.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-2 mt-1">
                      {p.intent_text}
                    </p>
                    <div className="flex items-center justify-between text-xs text-slate-500 mt-2.5 pt-2 border-t border-slate-100">
                      <span>Funded: {formatCurrency(entry.funded)}</span>
                      <span>Disbursed: {formatCurrency(entry.released)}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Right 2 columns: Selected Grant Details & Milestones */}
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-lg font-bold text-slate-900">
                      Grant #{activeProject.project.id}
                    </h2>
                    <span
                      className={`px-2.5 py-0.5 rounded-md text-xs font-semibold ${statusBadgeClass(
                        activeProject.project.status
                      )}`}
                    >
                      {activeProject.project.status}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 mt-1">
                    {activeProject.project.intent_text}
                  </p>
                </div>

                <button
                  onClick={() => handleReleaseHoldback(activeProject.project.id)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 shrink-0"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Release {activeProject.project.holdback_pct}% Retention Holdback
                </button>
              </div>

              {/* Financial progress bar */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4">
                <div className="flex justify-between text-xs font-semibold text-slate-700 mb-2">
                  <span>
                    Disbursed: {formatCurrency(activeProject.released)} of{" "}
                    {formatCurrency(activeProject.funded)}
                  </span>
                  <span>
                    Holdback Reserved: {activeProject.project.holdback_pct}% (
                    {formatCurrency(
                      (activeProject.project.total_amount *
                        activeProject.project.holdback_pct) /
                        100
                    )}
                    )
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-teal-600 transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        activeProject.funded
                          ? (activeProject.released / activeProject.funded) * 100
                          : 0
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* Milestones list */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Contract Milestones &amp; Tranche Schedule
                </h3>
                {activeProject.milestones.map((m) => {
                  let reqs = [];
                  try {
                    reqs = JSON.parse(m.evidence_requirements_json || "[]");
                  } catch {
                    reqs = [];
                  }
                  return (
                    <div
                      key={m.id}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">
                            {m.order_no}
                          </span>
                          <span className="font-semibold text-sm text-slate-900">
                            {m.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="text-sm font-bold text-slate-900">
                            {formatCurrency(m.tranche_amount)}
                          </span>
                          <span
                            className={`px-2.5 py-0.5 rounded-md text-xs font-semibold ${statusBadgeClass(
                              m.status
                            )}`}
                          >
                            {m.status}
                          </span>
                        </div>
                      </div>
                      {m.description && (
                        <p className="text-xs text-slate-600 pl-8">
                          {m.description}
                        </p>
                      )}
                      {reqs.length > 0 && (
                        <ul className="pl-12 list-disc text-xs text-slate-500 space-y-0.5">
                          {reqs.map((r, idx) => (
                            <li key={idx}>{r}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )
      ) : (
        /* Create New Grant View */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form
            onSubmit={handleStructureContract}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 h-fit"
          >
            <div>
              <h2 className="text-base font-bold text-slate-900">
                1. Define Grant Program Objective
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Describe the outcome you want to fund. Our Gemini Contract Agent structures measurable milestones and mandatory verification rules.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  Program Objective &amp; Target Beneficiaries
                </label>
                <span className="text-[11px] text-teal-700 font-medium">Any Charitable Cause</span>
              </div>
              <textarea
                value={intentText}
                onChange={(e) => setIntentText(e.target.value)}
                rows={4}
                required
                className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                <span className="text-[11px] text-slate-400 font-semibold mr-1">Quick cause presets:</span>
                <button
                  type="button"
                  onClick={() => setIntentText("Deliver 50 emergency flood relief food kits and medical kits to families in coastal villages")}
                  className="px-2 py-0.5 rounded text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                >
                  🌊 Disaster Relief
                </button>
                <button
                  type="button"
                  onClick={() => setIntentText("Construct a community solar water pump and 2km distribution line for 200 rural households")}
                  className="px-2 py-0.5 rounded text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                >
                  💧 Clean Water
                </button>
                <button
                  type="button"
                  onClick={() => setIntentText("Conduct 100 free pediatric cataract surgeries and post-operative vision follow-ups at mobile clinic")}
                  className="px-2 py-0.5 rounded text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                >
                  🏥 Healthcare
                </button>
                <button
                  type="button"
                  onClick={() => setIntentText("Plant 1,000 native mangrove saplings and maintain seedling survival monitoring for 6 months")}
                  className="px-2 py-0.5 rounded text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                >
                  🌱 Environment
                </button>
                <button
                  type="button"
                  onClick={() => setIntentText("Fund school tuition, textbooks, and monthly attendance registers for 30 girls")}
                  className="px-2 py-0.5 rounded text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                >
                  📚 Education
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Total Grant Amount (USD)
                </label>
                <input
                  type="number"
                  min={50}
                  step={50}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Final Retention Holdback (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={holdbackPct}
                  onChange={(e) => setHoldbackPct(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loadingDraft}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm disabled:opacity-50 transition"
            >
              <Sparkles className="w-4 h-4" />
              {loadingDraft
                ? "Structuring Milestones with Gemini..."
                : "StructureVerifiable Milestone Contract"}
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900">
              2. Review Contract &amp; Fund via PayPal
            </h2>
            {!draft ? (
              <div className="py-12 text-center text-sm text-slate-500">
                Submit your program objective on the left to review the structured milestone schedule before funding.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                  <span>
                    Structured by:{" "}
                    <strong className="uppercase text-teal-700">
                      Gemini ({draft.source})
                    </strong>
                  </span>
                  <span>
                    Retention Holdback:{" "}
                    <strong>{formatCurrency(draft.holdback_amount)}</strong>
                  </span>
                </div>

                {draft.clarifying_questions?.length > 0 && (
                  <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                      Suggested Contract Refinements:
                    </div>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {draft.clarifying_questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-2.5">
                  {draft.milestones.map((m) => (
                    <div
                      key={m.order_no}
                      className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60"
                    >
                      <div className="flex items-center justify-between font-semibold text-sm text-slate-900">
                        <span>
                          {m.order_no}. {m.title}
                        </span>
                        <span>{formatCurrency(m.tranche_amount)}</span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">
                        {m.description}
                      </p>
                      <ul className="list-disc pl-5 mt-2 text-xs text-slate-500 space-y-0.5">
                        {m.evidence_requirements.map((r, idx) => (
                          <li key={idx}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleApproveAndFund}
                  disabled={fundingGrant}
                  className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-[#003087] hover:bg-[#001c64] text-white font-semibold text-sm shadow-sm disabled:opacity-50 transition"
                >
                  <CreditCard className="w-4 h-4" />
                  {fundingGrant
                    ? "Processing PayPal Order & Capture..."
                    : `Approve Contract & Fund ${formatCurrency(
                        draft.budget
                      )} with PayPal`}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
