import React, { useEffect, useState } from "react";
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Key,
  Building,
  RefreshCw,
  Scale,
} from "lucide-react";
import { api, formatCurrency, statusBadgeClass } from "../api.js";

export default function VerifierWorkspace({
  projects = [],
  activeInvites = [],
  onInviteCreated,
  onRefresh,
  notify,
}) {
  const allMilestones = projects.flatMap((entry) =>
    entry.milestones.map((m) => ({
      ...m,
      projectIntent: entry.project.intent_text,
    }))
  );

  const [selectedMilestoneId, setSelectedMilestoneId] = useState(
    allMilestones[0]?.id || ""
  );
  const [tokenInput, setTokenInput] = useState(
    activeInvites[0]?.token || ""
  );
  const [tokenInfo, setTokenInfo] = useState(null);
  const [reportedAmount, setReportedAmount] = useState(300);
  const [responseNote, setResponseNote] = useState(
    "Confirmed: Goods/services delivered in full and verified on-site."
  );
  const [disputeReason, setDisputeReason] = useState("");
  const [raisedBy, setRaisedBy] = useState(
    "Community Parent-Teacher Representative"
  );
  const [confirmations, setConfirmations] = useState([]);

  useEffect(() => {
    if (!selectedMilestoneId && allMilestones[0]?.id) {
      setSelectedMilestoneId(allMilestones[0].id);
      setReportedAmount(allMilestones[0].tranche_amount || 300);
    }
  }, [allMilestones, selectedMilestoneId]);

  useEffect(() => {
    if (activeInvites.length > 0 && !tokenInput) {
      setTokenInput(activeInvites[0].token);
      if (activeInvites[0].tranche_amount) {
        setReportedAmount(activeInvites[0].tranche_amount);
      }
    }
  }, [activeInvites, tokenInput]);

  useEffect(() => {
    if (tokenInput.trim()) {
      inspectToken(tokenInput.trim());
    } else {
      setTokenInfo(null);
    }
  }, [tokenInput]);

  useEffect(() => {
    if (selectedMilestoneId) {
      loadMilestoneConfirmations(selectedMilestoneId);
    }
  }, [selectedMilestoneId]);

  async function inspectToken(token) {
    try {
      const data = await api(`/confirm/${token}`);
      setTokenInfo(data);
    } catch {
      setTokenInfo(null);
    }
  }

  async function loadMilestoneConfirmations(milestoneId) {
    try {
      const data = await api(`/milestones/${milestoneId}/confirmations`);
      setConfirmations(Array.isArray(data) ? data : []);
    } catch {
      setConfirmations([]);
    }
  }

  async function handleGenerateInvitesForMilestone() {
    const m =
      allMilestones.find((item) => item.id === Number(selectedMilestoneId)) ||
      allMilestones[0];
    if (!m) return;
    try {
      const vInvite = await api(`/milestones/${m.id}/confirmations/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "vendor",
          contact_ref: "Primary Local Supplier (+91-98201-11001)",
        }),
      });
      const bInvite = await api(`/milestones/${m.id}/confirmations/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "beneficiary",
          contact_ref: "Community Beneficiary Representative (+91-98201-22002)",
        }),
      });
      const list = [
        {
          ...vInvite,
          contact_ref: "Primary Local Supplier",
          tranche_amount: m.tranche_amount,
        },
        {
          ...bInvite,
          contact_ref: "Community Beneficiary Representative",
          tranche_amount: m.tranche_amount,
        },
      ];
      if (onInviteCreated) onInviteCreated(list);
      setTokenInput(vInvite.token);
      setReportedAmount(m.tranche_amount);
      await loadMilestoneConfirmations(m.id);
      await onRefresh();
      notify("Issued Supplier & Beneficiary verification tokens.");
    } catch (err) {
      notify(`Failed to generate tokens: ${err.message}`, "error");
    }
  }

  async function handleSubmitConfirmation(isConfirmed) {
    if (!tokenInput.trim()) {
      notify("Please provide a valid attestation token.", "error");
      return;
    }
    try {
      const res = await api(`/confirm/${tokenInput.trim()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmed: isConfirmed,
          reported_amount: Number(reportedAmount),
          answers: {},
          free_text: responseNote,
        }),
      });
      await inspectToken(tokenInput.trim());
      if (selectedMilestoneId) {
        await loadMilestoneConfirmations(selectedMilestoneId);
      }
      await onRefresh();
      notify("Attestation statement recorded.");
    } catch (err) {
      notify(`Attestation notice: ${err.message}`, "error");
    }
  }

  async function handleRaiseDispute(e) {
    e.preventDefault();
    const mId = selectedMilestoneId || allMilestones[0]?.id;
    if (!mId || !disputeReason.trim()) return;
    try {
      await api(`/milestones/${mId}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raised_by: raisedBy,
          reason: disputeReason,
        }),
      });
      setDisputeReason("");
      await onRefresh();
      notify(`Dispute filed on Milestone #${mId}. Payouts paused pending compliance.`);
    } catch (err) {
      notify(`Could not file dispute: ${err.message}`, "error");
    }
  }

  const matchedCount = confirmations.filter((c) => c.matched).length;

  return (
    <div className="space-y-6">
      {/* Banner in Warm Amber & Ochre Theme */}
      <div className="bg-gradient-to-r from-amber-950 via-amber-900 to-warmgray-900 text-white rounded-2xl p-6 shadow-sm border border-amber-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-amber-300 text-xs font-bold uppercase tracking-wider">
            <Scale className="w-4 h-4 text-amber-400" />
            <span>Independent Third-Party Sign-Off</span>
          </div>
          <h1 className="text-xl font-bold font-serif">
            Vendor &amp; Beneficiary Attestation Portal
          </h1>
          <p className="text-xs text-warmgray-300">
            Suppliers and local representatives verify delivery of supplies or report unfulfilled work.
          </p>
        </div>

        <button
          type="button"
          onClick={handleGenerateInvitesForMilestone}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-warmgray-950 transition cursor-pointer shadow-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Generate Fresh Tokens
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 cols: Sign-Off */}
        <div className="lg:col-span-7 bg-white border border-warmgray-200 rounded-2xl p-6 space-y-5">
          <h2 className="text-base font-bold text-warmgray-900 font-serif border-b border-warmgray-100 pb-3">
            Tokenized Attestation
          </h2>

          {activeInvites.length > 0 && (
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-warmgray-600">
                Active Verification Links
              </label>
              <div className="flex flex-wrap gap-2">
                {activeInvites.map((inv) => (
                  <button
                    key={inv.token}
                    type="button"
                    onClick={() => {
                      setTokenInput(inv.token);
                      if (inv.tranche_amount) {
                        setReportedAmount(inv.tranche_amount);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                      tokenInput === inv.token
                        ? "bg-amber-700 text-white border-amber-700"
                        : "bg-warmgray-50 text-warmgray-700 border-warmgray-200 hover:bg-warmgray-100"
                    }`}
                  >
                    {String(inv.kind || "witness").toUpperCase()}: {inv.contact_ref}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-warmgray-700 mb-1">
                Attestation Token
              </label>
              <div className="relative">
                <Key className="w-4 h-4 text-warmgray-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Paste token or select link above..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-warmgray-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-600"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-warmgray-700 mb-1">
                Verified Amount ($)
              </label>
              <input
                type="number"
                step="10"
                value={reportedAmount}
                onChange={(e) => setReportedAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-warmgray-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
              />
            </div>
          </div>

          {tokenInfo ? (
            <div className="p-4 rounded-xl bg-warmgray-50 border border-warmgray-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-warmgray-900">
                  {tokenInfo.milestone_title}
                </span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-warmgray-200 text-warmgray-800">
                  {tokenInfo.status}
                </span>
              </div>
              <p className="text-xs text-warmgray-600">
                {tokenInfo.milestone_description}
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-warmgray-50 border border-warmgray-200 text-xs text-warmgray-500 text-center">
              Select an attestation link or enter a token to load details.
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-warmgray-700 mb-1">
              Field Remarks / Confirmation Statement
            </label>
            <textarea
              rows={3}
              value={responseNote}
              onChange={(e) => setResponseNote(e.target.value)}
              className="w-full rounded-xl border border-warmgray-300 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleSubmitConfirmation(true)}
              className="inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-forest-700 hover:bg-forest-600 text-white font-bold text-sm shadow-sm transition cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              Confirm Delivery
            </button>
            <button
              type="button"
              onClick={() => handleSubmitConfirmation(false)}
              className="inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-terracotta-700 hover:bg-terracotta-600 text-white font-bold text-sm shadow-sm transition cursor-pointer"
            >
              <XCircle className="w-4 h-4" />
              Report Discrepancy
            </button>
          </div>
        </div>

        {/* Right 5 cols: Dispute filing */}
        <div className="lg:col-span-5 space-y-5">
          <form
            onSubmit={handleRaiseDispute}
            className="bg-white border border-terracotta-200 rounded-2xl p-6 space-y-4 shadow-sm"
          >
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-5 h-5 text-terracotta-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-warmgray-900 font-serif">
                  Report Delivery Dispute
                </h3>
                <p className="text-xs text-warmgray-500 mt-0.5">
                  Immediately freezes disbursement for this deliverable pending auditor review.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-warmgray-700 mb-1">
                Milestone Selection
              </label>
              <select
                value={selectedMilestoneId}
                onChange={(e) => setSelectedMilestoneId(Number(e.target.value))}
                className="w-full rounded-xl border border-warmgray-300 px-3 py-2 text-xs font-semibold text-warmgray-900 bg-white"
              >
                {allMilestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    #{m.id} • {m.title} ({formatCurrency(m.tranche_amount)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-warmgray-700 mb-1">
                Reporter Identity &amp; Role
              </label>
              <input
                type="text"
                value={raisedBy}
                onChange={(e) => setRaisedBy(e.target.value)}
                required
                className="w-full rounded-xl border border-warmgray-300 px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-warmgray-700 mb-1">
                Discrepancy Detail
              </label>
              <textarea
                rows={3}
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="Describe missing materials, altered invoices, or work not completed..."
                required
                minLength={5}
                className="w-full rounded-xl border border-warmgray-300 p-2.5 text-xs"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-xl bg-terracotta-700 hover:bg-terracotta-600 text-white font-bold text-xs shadow-sm transition cursor-pointer"
            >
              Freeze Deliverable &amp; Escalate
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
