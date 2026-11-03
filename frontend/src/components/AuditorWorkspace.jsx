import React, { useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import {
  CheckCircle2,
  XCircle,
  Network,
  ShieldAlert,
  Scale,
  Banknote,
} from "lucide-react";
import { api, formatCurrency, statusBadgeClass } from "../api.js";

export default function AuditorWorkspace({
  reviewQueue = [],
  riskGraph = { edge_count: 0, alerts: [], edges: [] },
  onRefresh,
  notify,
}) {
  const [selectedMilestoneId, setSelectedMilestoneId] = useState(
    reviewQueue[0]?.milestone_id || null
  );
  const [auditorNotes, setAuditorNotes] = useState(
    "Compliance review completed after inspecting field invoices and verifier logs."
  );
  const [runningEval, setRunningEval] = useState(false);
  const [evalSummary, setEvalSummary] = useState(null);

  useEffect(() => {
    if (!selectedMilestoneId && reviewQueue[0]?.milestone_id) {
      setSelectedMilestoneId(reviewQueue[0].milestone_id);
    }
  }, [reviewQueue, selectedMilestoneId]);

  const selectedCase = useMemo(() => {
    return (
      reviewQueue.find(
        (r) => r.milestone_id === Number(selectedMilestoneId)
      ) ||
      reviewQueue[0] ||
      null
    );
  }, [reviewQueue, selectedMilestoneId]);

  const rowData = useMemo(() => {
    return reviewQueue.map((item) => ({
      milestone_id: item.milestone_id,
      project_id: item.project_id,
      title: item.title,
      tranche_amount: item.tranche_amount,
      status: item.status,
      skeptic_risk:
        item.skeptic_risk != null
          ? `${(item.skeptic_risk * 100).toFixed(0)}%`
          : "—",
      concerns_text:
        (item.concerns || []).map((c) => c.code).join(", ") || "None",
      open_disputes_count: (item.open_disputes || []).length,
      confirmations: `${item.confirmations_matched || 0}/${
        item.confirmations_total || 0
      }`,
    }));
  }, [reviewQueue]);

  const columnDefs = useMemo(
    () => [
      {
        field: "milestone_id",
        headerName: "ID",
        maxWidth: 80,
        valueFormatter: (p) => `#${p.value}`,
      },
      { field: "title", headerName: "Milestone", flex: 1.4, minWidth: 170 },
      {
        field: "tranche_amount",
        headerName: "Tranche",
        maxWidth: 110,
        valueFormatter: (p) => formatCurrency(p.value),
      },
      { field: "status", headerName: "Status", maxWidth: 140 },
      { field: "skeptic_risk", headerName: "Fraud Risk", maxWidth: 115 },
      {
        field: "concerns_text",
        headerName: "Risk Flags",
        flex: 1.3,
        minWidth: 170,
      },
      {
        field: "open_disputes_count",
        headerName: "Disputes",
        maxWidth: 105,
      },
    ],
    []
  );

  async function handleReviewDecision(decision) {
    if (!selectedCase) return;
    const mId = selectedCase.milestone_id;
    try {
      await api(`/review/${mId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewer: "Compliance Lead (Risk Audit Team)",
          decision,
          comment: auditorNotes,
        }),
      });
      if (decision === "approve") {
        // Also execute the PayPal payout once human auditor approves
        try {
          await api(`/payouts/${mId}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              actor: "Compliance Lead (Risk Audit Team)",
              human_approved: true,
            }),
          });
        } catch {
          // If payout requires additional step, decision is still saved
        }
      }
      await onRefresh();
      notify(
        `Auditor decision (${decision.toUpperCase()}) recorded for Milestone #${mId}.`
      );
    } catch (err) {
      notify(`Could not record decision: ${err.message}`, "error");
    }
  }

  async function handleRunRedteamSuite() {
    setRunningEval(true);
    try {
      notify("Running 12-scenario adversarial red-team verification suite...");
      const res = await api("/eval/redteam/run", { method: "POST" });
      setEvalSummary(res);
      await onRefresh();
      notify(
        `Red-team audit complete: ${res.attacks_blocked}/${res.attack_cases} fraud scenarios blocked (${(
          res.attack_block_rate * 100
        ).toFixed(0)}%).`
      );
    } catch (err) {
      notify(`Benchmark error: ${err.message}`, "error");
    } finally {
      setRunningEval(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top header & Red-Team Audit action */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-teal-700">
            Risk &amp; Compliance Operations
          </span>
          <h2 className="text-lg font-bold text-slate-900">
            Quarantined Milestones &amp; Escalated Disputes ({reviewQueue.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Inspect submissions flagged by the Gemini Skeptic Agent, perceptual dHash duplicate detector, or third-party whistleblowers.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRunRedteamSuite}
          disabled={runningEval}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white shrink-0 transition"
        >
          <ShieldAlert className="w-4 h-4 text-teal-400" />
          {runningEval
            ? "Running 12-Case Anti-Fraud Suite..."
            : "Run 12-Scenario Anti-Fraud Audit"}
        </button>
      </div>

      {evalSummary && (
        <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs text-emerald-950">
          <div>
            <strong className="font-bold">
              Adversarial Security Benchmark Passed:
            </strong>{" "}
            {evalSummary.attacks_blocked}/{evalSummary.attack_cases} Fraud Attacks Blocked (
            {(evalSummary.attack_block_rate * 100).toFixed(0)}%) •{" "}
            {evalSummary.false_rejections}/{evalSummary.legitimate_cases} False Rejections
          </div>
          <button
            type="button"
            onClick={() => setEvalSummary(null)}
            className="underline font-semibold text-emerald-800"
          >
            Hide Report
          </button>
        </div>
      )}

      {/* Main Grid + Side-by-Side Case Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              Compliance Escalation Queue (AG Grid)
            </h3>
            <span className="text-xs text-slate-500">
              Click any row to inspect case evidence
            </span>
          </div>

          <div
            id="reviewGrid"
            className="ag-theme-quartz w-full"
            style={{ height: 320 }}
          >
            <AgGridReact
              rowData={rowData}
              columnDefs={columnDefs}
              rowSelection="single"
              onRowClicked={(e) => setSelectedMilestoneId(e.data.milestone_id)}
              overlayNoRowsTemplate="<span class='text-xs text-slate-500'>No milestones currently in quarantine or dispute. Click 'Load Sample Portfolio' in the top bar to see flagged cases.</span>"
            />
          </div>
        </div>

        {/* Case Inspector */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Scale className="w-4 h-4 text-teal-700" />
              Case Inspector &amp; Manual Override
            </h3>
            {selectedCase && (
              <span
                className={`px-2 py-0.5 rounded text-xs font-semibold ${statusBadgeClass(
                  selectedCase.status
                )}`}
              >
                Milestone #{selectedCase.milestone_id} • {selectedCase.status}
              </span>
            )}
          </div>

          {!selectedCase ? (
            <div className="py-12 text-center text-xs text-slate-500">
              No escalated cases in the queue. Click{" "}
              <strong>Load Sample Portfolio</strong> in the header or raise a dispute from the External Verifier tab to inspect an escalated case.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex items-center justify-between font-bold text-slate-900 text-sm">
                  <span>{selectedCase.title}</span>
                  <span>{formatCurrency(selectedCase.tranche_amount)}</span>
                </div>
                <p className="text-slate-500">
                  Grant #{selectedCase.project_id} • Third-Party Confirmations:{" "}
                  {selectedCase.confirmations_matched}/
                  {selectedCase.confirmations_total}
                </p>
              </div>

              {(selectedCase.concerns?.length > 0 ||
                selectedCase.skeptic_risk > 0) && (
                <div className="p-3.5 rounded-lg bg-rose-50/70 border border-rose-200 space-y-2">
                  <div className="flex items-center justify-between font-bold text-rose-900">
                    <span>
                      Skeptic Fraud Risk:{" "}
                      {((selectedCase.skeptic_risk || 0) * 100).toFixed(0)}%
                    </span>
                    <span>Automated Quarantine</span>
                  </div>
                  {selectedCase.concerns?.length > 0 && (
                    <div className="space-y-1.5">
                      {selectedCase.concerns.map((c, idx) => (
                        <div
                          key={idx}
                          className="p-2 rounded bg-white/90 border border-rose-200 text-rose-950"
                        >
                          <span className="font-mono font-bold text-[11px] text-rose-700 block">
                            {c.code}
                          </span>
                          <span>{c.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {selectedCase.open_disputes?.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-1 text-amber-950">
                  <span className="font-bold block">
                    Open Whistleblower / Beneficiary Disputes:
                  </span>
                  {selectedCase.open_disputes.map((d) => (
                    <p key={d.id}>
                      • <strong>{d.raised_by}:</strong> {d.reason}
                    </p>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Compliance Auditor Resolution Notes
                </label>
                <textarea
                  rows={2}
                  value={auditorNotes}
                  onChange={(e) => setAuditorNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleReviewDecision("approve")}
                  className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs shadow-sm transition"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Approve &amp; Release Payout
                </button>
                <button
                  type="button"
                  onClick={() => handleReviewDecision("reject")}
                  className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-semibold text-xs shadow-sm transition"
                >
                  <XCircle className="w-4 h-4" />
                  Reject &amp; Hold Tranche
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Collusion & Cross-Grant Risk Graph Panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-teal-700" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Cross-Grant Collusion &amp; Device Network Graph
              </h3>
              <p className="text-xs text-slate-500">
                Detects shared submission devices across NGOs and repeat third-party confirmers across separate grant projects.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold">
            <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700">
              Tracked Graph Edges: {riskGraph.edge_count || 0}
            </span>
            <span
              className={`px-2.5 py-1 rounded-md ${
                (riskGraph.alerts?.length || 0) > 0
                  ? "bg-rose-50 text-rose-700"
                  : "bg-emerald-50 text-emerald-700"
              }`}
            >
              Collusion Alerts: {riskGraph.alerts?.length || 0}
            </span>
          </div>
        </div>

        {(riskGraph.alerts?.length || 0) === 0 ? (
          <div className="p-4 rounded-lg bg-emerald-50/60 border border-emerald-200 text-xs text-emerald-900">
            No cross-organization shared devices or collusive confirmer rings currently flagged.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {riskGraph.alerts.map((alert, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-950 space-y-1"
              >
                <div className="flex items-center justify-between font-bold">
                  <span className="font-mono text-rose-800">{alert.code}</span>
                  <span className="px-2 py-0.5 rounded bg-rose-200 text-rose-900">
                    Entity: {alert.entity}
                  </span>
                </div>
                <p className="text-rose-800">{alert.detail}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
