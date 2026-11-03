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
  FileCheck,
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
        headerName: "Flags",
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
          reviewer: "Compliance Auditor",
          decision,
          comment: auditorNotes,
        }),
      });
      if (decision === "approve") {
        try {
          await api(`/payouts/${mId}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              actor: "Compliance Auditor",
              human_approved: true,
            }),
          });
        } catch {}
      }
      await onRefresh();
      notify(`Auditor resolution recorded (${decision.toUpperCase()}).`);
    } catch (err) {
      notify(`Action error: ${err.message}`, "error");
    }
  }

  async function handleRunRedteamSuite() {
    setRunningEval(true);
    try {
      notify("Executing benchmark verification audit...");
      const res = await api("/eval/redteam/run", { method: "POST" });
      setEvalSummary(res);
      await onRefresh();
      notify(
        `Benchmark: ${res.attacks_blocked}/${res.attack_cases} fraud attacks blocked (${(
          res.attack_block_rate * 100
        ).toFixed(0)}%).`
      );
    } catch (err) {
      notify(`Benchmark notice: ${err.message}`, "error");
    } finally {
      setRunningEval(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Banner with Plum / Deep Wine Theme */}
      <div className="bg-gradient-to-r from-plum-950 via-plum-900 to-warmgray-900 text-white rounded-2xl p-6 shadow-sm border border-plum-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-plum-300 text-xs font-bold uppercase tracking-wider">
            <Scale className="w-4 h-4 text-plum-300" />
            <span>Risk, Fraud &amp; Compliance Console</span>
          </div>
          <h1 className="text-xl font-bold font-serif">
            Escalation Queue &amp; Collusion Analysis
          </h1>
          <p className="text-xs text-warmgray-300">
            Audit disputed tranches, inspect duplicate invoice alerts, and investigate shared hardware networks.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRunRedteamSuite}
          disabled={runningEval}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-plum-800 hover:bg-plum-700 text-white border border-plum-600 transition cursor-pointer shadow-sm"
        >
          <ShieldAlert className="w-4 h-4 text-plum-300" />
          {runningEval ? "Running Security Audit..." : "Run Adversarial Security Benchmark"}
        </button>
      </div>

      {evalSummary && (
        <div className="bg-forest-50 border border-forest-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs text-forest-950">
          <div>
            <strong>Security Benchmark Completed:</strong> {evalSummary.attacks_blocked}/
            {evalSummary.attack_cases} Fraud Vectors Prevented (
            {(evalSummary.attack_block_rate * 100).toFixed(0)}%) •{" "}
            {evalSummary.false_rejections}/{evalSummary.legitimate_cases} False Rejections
          </div>
          <button
            type="button"
            onClick={() => setEvalSummary(null)}
            className="underline font-bold text-forest-800 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Grid + Case Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-warmgray-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-warmgray-900 font-serif">
              Compliance Escalation Queue
            </h3>
            <span className="text-xs text-warmgray-500">
              Select any row to inspect details
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
              overlayNoRowsTemplate="<span class='text-xs text-warmgray-500'>No flagged deliverables in review queue.</span>"
            />
          </div>
        </div>

        {/* Case Inspector */}
        <div className="lg:col-span-5 bg-white border border-warmgray-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-warmgray-100 pb-3">
            <h3 className="text-sm font-bold text-warmgray-900 font-serif flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-plum-700" />
              Case Review &amp; Override
            </h3>
            {selectedCase && (
              <span
                className={`px-2 py-0.5 rounded text-xs font-semibold ${statusBadgeClass(
                  selectedCase.status
                )}`}
              >
                #{selectedCase.milestone_id} • {selectedCase.status}
              </span>
            )}
          </div>

          {!selectedCase ? (
            <div className="py-12 text-center text-xs text-warmgray-500">
              No active case selected. Click any row on the left to audit evidence.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-warmgray-50 border border-warmgray-200 space-y-1">
                <div className="flex items-center justify-between font-bold text-warmgray-900 text-sm">
                  <span>{selectedCase.title}</span>
                  <span className="text-forest-700">{formatCurrency(selectedCase.tranche_amount)}</span>
                </div>
                <p className="text-warmgray-500">
                  Grant #{selectedCase.project_id} • Confirmations: {selectedCase.confirmations_matched}/
                  {selectedCase.confirmations_total}
                </p>
              </div>

              {(selectedCase.concerns?.length > 0 ||
                selectedCase.skeptic_risk > 0) && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 space-y-2">
                  <div className="flex items-center justify-between font-bold text-rose-900">
                    <span>Fraud Risk: {((selectedCase.skeptic_risk || 0) * 100).toFixed(0)}%</span>
                    <span className="uppercase text-[10px] bg-rose-200 px-2 py-0.5 rounded">Quarantined</span>
                  </div>
                  {selectedCase.concerns?.map((c, idx) => (
                    <div key={idx} className="p-2 rounded-lg bg-white border border-rose-200 text-rose-950">
                      <span className="font-mono font-bold text-[11px] text-rose-800 block">
                        {c.code}
                      </span>
                      <span>{c.detail}</span>
                    </div>
                  ))}
                </div>
              )}

              {selectedCase.open_disputes?.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1 text-amber-950">
                  <span className="font-bold block">Open Third-Party Disputes:</span>
                  {selectedCase.open_disputes.map((d) => (
                    <p key={d.id}>
                      • <strong>{d.raised_by}:</strong> {d.reason}
                    </p>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-warmgray-700 mb-1">
                  Auditor Resolution Notes
                </label>
                <textarea
                  rows={2}
                  value={auditorNotes}
                  onChange={(e) => setAuditorNotes(e.target.value)}
                  className="w-full rounded-xl border border-warmgray-300 p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-plum-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleReviewDecision("approve")}
                  className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-forest-700 hover:bg-forest-600 text-white font-bold text-xs shadow-sm transition cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Approve &amp; Release
                </button>
                <button
                  type="button"
                  onClick={() => handleReviewDecision("reject")}
                  className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-terracotta-700 hover:bg-terracotta-600 text-white font-bold text-xs shadow-sm transition cursor-pointer"
                >
                  <XCircle className="w-4 h-4" />
                  Reject &amp; Hold
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Network Collusion Graph */}
      <div className="bg-white border border-warmgray-200 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-plum-700" />
            <div>
              <h3 className="text-sm font-bold text-warmgray-900 font-serif">
                Collusion &amp; Cross-Grant Hardware Graph
              </h3>
              <p className="text-xs text-warmgray-500">
                Detects shared hardware device fingerprints across distinct accounts and repeat confirmers.
              </p>
            </div>
          </div>
          <div className="text-xs font-semibold text-warmgray-600">
            Tracked Graph Edges: {riskGraph.edge_count || 0}
          </div>
        </div>

        {(riskGraph.alerts?.length || 0) === 0 ? (
          <div className="p-4 rounded-xl bg-forest-50 border border-forest-200 text-xs text-forest-900">
            No collusive clusters or cross-organization device sharing identified.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {riskGraph.alerts.map((alert, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-950 space-y-1"
              >
                <div className="flex items-center justify-between font-bold">
                  <span className="font-mono text-rose-800">{alert.code}</span>
                  <span className="px-2 py-0.5 rounded bg-rose-200 text-rose-900 text-[10px]">
                    {alert.entity}
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
