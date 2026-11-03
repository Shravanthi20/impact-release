import React, { useEffect, useState } from "react";
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Key,
  Building,
  RefreshCw,
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
    "Confirmed: Goods delivered in full and verified against school invoice."
  );
  const [disputeReason, setDisputeReason] = useState("");
  const [raisedBy, setRaisedBy] = useState(
    "School Parent-Teacher Committee Representative"
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
          contact_ref: "Deccan School Book Depot (+91-98201-11001)",
        }),
      });
      const bInvite = await api(`/milestones/${m.id}/confirmations/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "beneficiary",
          contact_ref: "Principal Kavita Kulkarni (+91-98201-22002)",
        }),
      });
      const list = [
        {
          ...vInvite,
          contact_ref: "Deccan School Book Depot (+91-98201-11001)",
          tranche_amount: m.tranche_amount,
        },
        {
          ...bInvite,
          contact_ref: "Principal Kavita Kulkarni (+91-98201-22002)",
          tranche_amount: m.tranche_amount,
        },
      ];
      if (onInviteCreated) onInviteCreated(list);
      setTokenInput(vInvite.token);
      setReportedAmount(m.tranche_amount);
      await loadMilestoneConfirmations(m.id);
      await onRefresh();
      notify("Issued Vendor & Beneficiary verification tokens for sign-off.");
    } catch (err) {
      notify(`Failed to create invites: ${err.message}`, "error");
    }
  }

  async function handleSubmitConfirmation(isConfirmed) {
    if (!tokenInput.trim()) {
      notify("Select or enter a confirmation token first.", "error");
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
      notify(
        `Third-party attestation recorded (${
          res.matched ? "Matched milestone terms" : "Flagged for Compliance Review"
        }).`
      );
    } catch (err) {
      notify(`Attestation failed: ${err.message}`, "error");
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
      notify(
        `Milestone #${mId} frozen and escalated to the Compliance Auditor Queue.`
      );
    } catch (err) {
      notify(`Could not file dispute: ${err.message}`, "error");
    }
  }

  const matchedCount = confirmations.filter((c) => c.matched).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left 7 columns: Independent Confirmer Sign-Off Portal */}
      <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-teal-700">
              Independent Field Attestation
            </span>
            <h2 className="text-lg font-bold text-slate-900">
              Vendor &amp; Beneficiary Sign-Off Portal
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Suppliers, school principals, and community witnesses verify receipt of goods or funds via magic-link tokens before PayPal tranche release.
            </p>
          </div>
          <button
            type="button"
            onClick={handleGenerateInvitesForMilestone}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 shrink-0 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Issue Fresh Tokens
          </button>
        </div>

        {activeInvites.length > 0 && (
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-600">
              Pending Attestation Links
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
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    tokenInput === inv.token
                      ? "bg-teal-700 text-white border-teal-700"
                      : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {String(inv.kind || "verifier").toUpperCase()}:{" "}
                  {inv.contact_ref}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              One-Time Attestation Token
            </label>
            <div className="relative">
              <Key className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Paste confirmation token or click 'Issue Fresh Tokens'..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Confirmed Amount (USD)
            </label>
            <input
              type="number"
              step="10"
              value={reportedAmount}
              onChange={(e) => setReportedAmount(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
        </div>

        {tokenInfo ? (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Building className="w-4 h-4 text-teal-700" />
                <span className="text-sm font-bold text-slate-900">
                  {tokenInfo.milestone_title}
                </span>
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-md text-xs font-semibold ${statusBadgeClass(
                  tokenInfo.status
                )}`}
              >
                {tokenInfo.status}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              {tokenInfo.milestone_description}
            </p>
            <div className="text-xs text-slate-500">
              Confirmer Role:{" "}
              <strong className="uppercase text-slate-800">
                {tokenInfo.kind}
              </strong>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500 text-center">
            Click <strong>Issue Fresh Tokens</strong> above (or invite confirmers from the NGO Field Partner view) to load a live attestation request.
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Attestation Statement / Delivery Remarks
          </label>
          <textarea
            rows={3}
            value={responseNote}
            onChange={(e) => setResponseNote(e.target.value)}
            className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleSubmitConfirmation(true)}
            className="inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm shadow-sm transition"
          >
            <CheckCircle2 className="w-4 h-4" />
            Confirm Delivery &amp; Receipt
          </button>
          <button
            type="button"
            onClick={() => handleSubmitConfirmation(false)}
            className="inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-semibold text-sm shadow-sm transition"
          >
            <XCircle className="w-4 h-4" />
            Reject / Report Discrepancy
          </button>
        </div>
      </div>

      {/* Right 5 columns: Milestone Quorum Status + Challenge Window Dispute */}
      <div className="lg:col-span-5 space-y-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
            Select Milestone for Inspection or Dispute
          </label>
          <select
            value={selectedMilestoneId}
            onChange={(e) => {
              const id = Number(e.target.value);
              setSelectedMilestoneId(id);
              const found = allMilestones.find((m) => m.id === id);
              if (found) setReportedAmount(found.tranche_amount);
            }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {allMilestones.map((m) => (
              <option key={m.id} value={m.id}>
                Grant #{m.project_id} • {m.title} (
                {formatCurrency(m.tranche_amount)})
              </option>
            ))}
          </select>

          <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700">
                Recorded Confirmations:
              </span>
              <span
                className={`px-2 py-0.5 rounded font-bold ${
                  matchedCount > 0
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-800"
                }`}
              >
                {matchedCount} Matched / {confirmations.length} Total
              </span>
            </div>
            {confirmations.map((c) => (
              <div
                key={c.id}
                className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-bold uppercase text-slate-800">
                    {c.kind}
                  </span>
                  <span className="text-slate-500 block">{c.contact_ref}</span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded font-semibold ${statusBadgeClass(
                    c.matched ? "VERIFIED" : c.status
                  )}`}
                >
                  {c.matched ? "MATCHED" : c.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Challenge Window Whistleblower Dispute Form */}
        <form
          onSubmit={handleRaiseDispute}
          className="bg-white border border-rose-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Raise Challenge-Window Dispute
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Immediately freezes PayPal disbursement for the selected milestone and escalates to the Risk &amp; Compliance Auditor.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Reporter Name / Role
            </label>
            <input
              type="text"
              value={raisedBy}
              onChange={(e) => setRaisedBy(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Discrepancy Details (min 5 chars)
            </label>
            <textarea
              rows={2}
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              placeholder="Describe missing supplies, altered invoice figures, or unfulfilled field work..."
              required
              minLength={5}
              className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
            />
          </div>

          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-semibold text-xs shadow-sm transition"
          >
            <ShieldAlert className="w-4 h-4" />
            Freeze Milestone &amp; Escalate to Compliance Review
          </button>
        </form>
      </div>
    </div>
  );
}
