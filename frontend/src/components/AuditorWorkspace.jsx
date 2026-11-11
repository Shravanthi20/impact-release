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
  RefreshCw,
  Layers,
  Clock,
  AlertTriangle,
  AlertCircle,
  Check,
} from "lucide-react";
import { api, formatCurrency, statusBadgeClass } from "../api.js";

export default function AuditorWorkspace({
  projects = [],
  reviewQueue = [],
  riskGraph = { edge_count: 0, alerts: [], edges: [] },
  onRefresh,
  notify,
}) {
  const [activeTab, setActiveTab] = useState("queue"); // "queue" | "reconciliation" | "timeline"
  const [selectedMilestoneId, setSelectedMilestoneId] = useState(
    reviewQueue[0]?.milestone_id || null
  );
  const [auditorNotes, setAuditorNotes] = useState(
    "Compliance review completed after inspecting field invoices and verifier logs."
  );
  const [runningEval, setRunningEval] = useState(false);
  const [evalSummary, setEvalSummary] = useState(null);

  // Reconciliation state
  const [runningRecon, setRunningRecon] = useState(false);
  const [discrepancies, setDiscrepancies] = useState([]);
  const [journalEntries, setJournalEntries] = useState([]);
  const [journalVerification, setJournalVerification] = useState(null);

  // Timeline state
  const [selectedProjectId, setSelectedProjectId] = useState(
    projects[0]?.project?.id || ""
  );
  const [timelineData, setTimelineData] = useState(null);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  useEffect(() => {
    if (!selectedMilestoneId && reviewQueue[0]?.milestone_id) {
      setSelectedMilestoneId(reviewQueue[0].milestone_id);
    }
  }, [reviewQueue, selectedMilestoneId]);

  useEffect(() => {
    if (!selectedProjectId && projects[0]?.project?.id) {
      setSelectedProjectId(projects[0].project.id);
    }
  }, [projects, selectedProjectId]);

  const loadReconciliationData = async () => {
    try {
      const [disc, jnl, verify] = await Promise.all([
        api("/reconciliation/discrepancies"),
        api("/ledger/journal"),
        api("/ledger/journal/verify"),
      ]);
      setDiscrepancies(disc);
      setJournalEntries(jnl);
      setJournalVerification(verify);
    } catch (err) {
      // Quiet fail if network glitch
    }
  };

  useEffect(() => {
    if (activeTab === "reconciliation") {
      loadReconciliationData();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "timeline" && selectedProjectId) {
      setLoadingTimeline(true);
      api(`/audit/timeline/${selectedProjectId}`)
        .then((res) => setTimelineData(res))
        .catch(() => setTimelineData(null))
        .finally(() => setLoadingTimeline(false));
    }
  }, [activeTab, selectedProjectId]);

  async function handleRunReconciliation() {
    setRunningRecon(true);
    try {
      notify("Executing automated PayPal API ledger reconciliation...");
      const res = await api("/reconciliation/run", { method: "POST" });
      await loadReconciliationData();
      await onRefresh();
      notify(
        `Reconciliation complete: ${res.scanned_payouts} scanned, ${res.reconciled_payouts} reconciled, ${res.open_discrepancies} exceptions.`
      );
    } catch (err) {
      notify(`Reconciliation error: ${err.message}`, "error");
    } finally {
      setRunningRecon(false);
    }
  }

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
      {/* Top Banner with Plum Theme */}
      <div className="bg-gradient-to-r from-plum-950 via-plum-900 to-warmgray-900 text-white rounded-2xl p-6 shadow-sm border border-plum-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-plum-300 text-xs font-bold uppercase tracking-wider">
            <Scale className="w-4 h-4 text-plum-300" />
            <span>Risk, Fraud &amp; Compliance Console</span>
          </div>
          <h1 className="text-xl font-bold font-serif">
            Escalation Queue &amp; Ledger Auditing
          </h1>
          <p className="text-xs text-warmgray-300">
            Audit disputed tranches, inspect automated PayPal ledger reconciliation, and review 7-stage forensic timelines.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRunRedteamSuite}
            disabled={runningEval}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-plum-800 hover:bg-plum-700 text-white border border-plum-600 transition cursor-pointer shadow-sm"
          >
            <ShieldAlert className="w-4 h-4 text-plum-300" />
            {runningEval ? "Auditing Benchmark..." : "Security Benchmark"}
          </button>
        </div>
      </div>

      {/* Sub-tab navigation */}
      <div className="flex border-b border-warmgray-200 gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("queue")}
          className={`pb-3 px-4 text-xs font-bold transition flex items-center gap-2 border-b-2 cursor-pointer ${
            activeTab === "queue"
              ? "border-plum-800 text-plum-900"
              : "border-transparent text-warmgray-500 hover:text-warmgray-800"
          }`}
        >
          <Scale className="w-4 h-4" />
          Escalation Queue ({reviewQueue.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("reconciliation")}
          className={`pb-3 px-4 text-xs font-bold transition flex items-center gap-2 border-b-2 cursor-pointer ${
            activeTab === "reconciliation"
              ? "border-plum-800 text-plum-900"
              : "border-transparent text-warmgray-500 hover:text-warmgray-800"
          }`}
        >
          <Layers className="w-4 h-4" />
          PayPal Reconciliation &amp; General Ledger
          {discrepancies.length > 0 && (
            <span className="bg-rose-500 text-white rounded-full text-[10px] px-1.5 py-0.2">
              {discrepancies.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("timeline")}
          className={`pb-3 px-4 text-xs font-bold transition flex items-center gap-2 border-b-2 cursor-pointer ${
            activeTab === "timeline"
              ? "border-plum-800 text-plum-900"
              : "border-transparent text-warmgray-500 hover:text-warmgray-800"
          }`}
        >
          <Clock className="w-4 h-4" />
          Forensic Project Timeline
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

      {/* TAB 1: ESCALATION QUEUE */}
      {activeTab === "queue" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-white border border-warmgray-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-warmgray-900 font-serif">
                  Compliance Escalation Queue
                </h3>
                <span className="text-xs text-warmgray-500">
                  Select any deliverable to audit findings
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
      )}

      {/* TAB 2: RECONCILIATION & GENERAL LEDGER */}
      {activeTab === "reconciliation" && (
        <div className="space-y-6">
          {/* Controls & Double-Entry Math Status */}
          <div className="bg-white border border-warmgray-200 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-warmgray-900 font-serif flex items-center gap-2">
                <Layers className="w-4 h-4 text-plum-700" />
                Double-Entry Mathematical Balance Verification
              </h3>
              <p className="text-xs text-warmgray-500 mt-0.5">
                Verifies total cumulative debits exactly equal total credits across all general ledger accounts.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {journalVerification && (
                <div
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 ${
                    journalVerification.is_balanced
                      ? "bg-forest-50 border-forest-200 text-forest-800"
                      : "bg-rose-50 border-rose-200 text-rose-800"
                  }`}
                >
                  {journalVerification.is_balanced ? (
                    <>
                      <Check className="w-4 h-4 text-forest-600" />
                      <span>Ledger Balanced (Debits: {formatCurrency(journalVerification.total_debits)} = Credits: {formatCurrency(journalVerification.total_credits)})</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-rose-600" />
                      <span>Ledger Imbalance Detected! Discrepancy: {journalVerification.discrepancy}</span>
                    </>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={handleRunReconciliation}
                disabled={runningRecon}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-plum-800 hover:bg-plum-700 text-white transition cursor-pointer shadow-sm disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${runningRecon ? "animate-spin" : ""}`} />
                {runningRecon ? "Reconciling with PayPal..." : "Execute PayPal Reconciliation"}
              </button>
            </div>
          </div>

          {/* Exception Queue */}
          <div className="bg-white border border-warmgray-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-warmgray-900 font-serif flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-plum-700" />
                Financial Exception Queue
              </h3>
              <span className="text-xs text-warmgray-500">
                {discrepancies.length} Active Exception{discrepancies.length !== 1 ? "s" : ""}
              </span>
            </div>

            {discrepancies.length === 0 ? (
              <div className="p-4 rounded-xl bg-forest-50 border border-forest-200 text-xs text-forest-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-forest-700" />
                No discrepancies found. Database state and PayPal API records are fully synchronized.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-warmgray-200 text-warmgray-600 font-bold bg-warmgray-50">
                      <th className="p-2.5">ID</th>
                      <th className="p-2.5">Entity</th>
                      <th className="p-2.5">Issue Type</th>
                      <th className="p-2.5">Severity</th>
                      <th className="p-2.5">DB State</th>
                      <th className="p-2.5">PayPal State</th>
                      <th className="p-2.5">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discrepancies.map((d) => (
                      <tr key={d.id} className="border-b border-warmgray-100 hover:bg-warmgray-50">
                        <td className="p-2.5 font-mono">#{d.id}</td>
                        <td className="p-2.5">{d.entity_type} #{d.entity_id}</td>
                        <td className="p-2.5 font-bold text-rose-800">{d.issue_type}</td>
                        <td className="p-2.5">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                            {d.severity}
                          </span>
                        </td>
                        <td className="p-2.5 font-mono text-warmgray-700">{d.db_state}</td>
                        <td className="p-2.5 font-mono text-warmgray-700">{d.paypal_state}</td>
                        <td className="p-2.5 font-mono text-warmgray-500">{d.external_ref}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Immutable General Ledger Entries */}
          <div className="bg-white border border-warmgray-200 rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-warmgray-900 font-serif">
              Immutable Double-Entry General Ledger (Append-Only)
            </h3>
            <div className="overflow-x-auto max-h-72">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-warmgray-200 text-warmgray-600 font-bold bg-warmgray-50 sticky top-0">
                    <th className="p-2.5">Entry #</th>
                    <th className="p-2.5">Type</th>
                    <th className="p-2.5">Debit Account</th>
                    <th className="p-2.5">Credit Account</th>
                    <th className="p-2.5">Amount</th>
                    <th className="p-2.5">Reference</th>
                    <th className="p-2.5">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {journalEntries.map((j) => (
                    <tr key={j.id} className="border-b border-warmgray-100 hover:bg-warmgray-50">
                      <td className="p-2.5 font-mono">#{j.id}</td>
                      <td className="p-2.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-warmgray-200 text-warmgray-800">
                          {j.entry_type}
                        </span>
                      </td>
                      <td className="p-2.5 font-mono text-forest-800">{j.debit_account}</td>
                      <td className="p-2.5 font-mono text-terracotta-800">{j.credit_account}</td>
                      <td className="p-2.5 font-bold text-warmgray-900">{formatCurrency(j.amount)}</td>
                      <td className="p-2.5 font-mono text-[11px] text-warmgray-500">{j.reference_id}</td>
                      <td className="p-2.5 text-warmgray-400 text-[11px]">{new Date(j.created_at).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: FORENSIC TIMELINE */}
      {activeTab === "timeline" && (
        <div className="space-y-6">
          <div className="bg-white border border-warmgray-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-warmgray-900 font-serif">
                Grant Forensic Audit Timeline
              </h3>
              <p className="text-xs text-warmgray-500">
                Answers the 7 forensic questions: funding initiator, escrow capture, submissions, AI agent findings, decisions, payouts, and PayPal status.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-warmgray-600">Select Grant:</label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                className="rounded-xl border border-warmgray-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-plum-600"
              >
                {projects.map((p) => (
                  <option key={p.project.id} value={p.project.id}>
                    Grant #{p.project.id} ({p.project.intent_text?.slice(0, 30) || "Escrow Contract"})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loadingTimeline ? (
            <div className="p-12 text-center text-xs text-warmgray-500 bg-white rounded-2xl border border-warmgray-200">
              Loading forensic timeline...
            </div>
          ) : !timelineData ? (
            <div className="p-12 text-center text-xs text-warmgray-500 bg-white rounded-2xl border border-warmgray-200">
              No audit timeline available for this project.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Question 1 & 2 cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-white border border-warmgray-200 space-y-2 text-xs">
                  <span className="font-bold text-warmgray-900 block font-serif">
                    1. Funding Initiator
                  </span>
                  <div className="text-warmgray-600 space-y-1">
                    <p><strong>Donor:</strong> {timelineData.forensic_audit_trail["1_who_initiated_funding"].donor_name}</p>
                    <p><strong>Email:</strong> {timelineData.forensic_audit_trail["1_who_initiated_funding"].donor_email}</p>
                    <p><strong>Created:</strong> {new Date(timelineData.forensic_audit_trail["1_who_initiated_funding"].created_at).toLocaleString()}</p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white border border-warmgray-200 space-y-2 text-xs">
                  <span className="font-bold text-warmgray-900 block font-serif">
                    2. Escrow Capital Capture
                  </span>
                  <div className="text-warmgray-600 space-y-1">
                    <p><strong>Total Grant Budget:</strong> {formatCurrency(timelineData.forensic_audit_trail["2_how_much_captured"].total_contract_amount)}</p>
                    <p><strong>Captured into Escrow:</strong> {formatCurrency(timelineData.forensic_audit_trail["2_how_much_captured"].captured_amount)}</p>
                    <p><strong>Retention Holdback:</strong> {formatCurrency(timelineData.forensic_audit_trail["2_how_much_captured"].holdback_amount)}</p>
                  </div>
                </div>
              </div>

              {/* Milestones & Verification Timeline */}
              <div className="bg-white border border-warmgray-200 rounded-2xl p-5 space-y-4">
                <h4 className="text-sm font-bold text-warmgray-900 font-serif">
                  3. Deliverable Lifecycle, AI Investigation &amp; Payout Settlements
                </h4>

                <div className="space-y-4">
                  {timelineData.forensic_audit_trail["3_milestones_and_evidence"].map((m) => (
                    <div key={m.milestone_id} className="p-4 rounded-xl border border-warmgray-200 bg-warmgray-50 space-y-3 text-xs">
                      <div className="flex items-center justify-between font-bold text-sm">
                        <span>Milestone #{m.order_no}: {m.title} {m.is_holdback && "(Holdback)"}</span>
                        <span className="text-forest-700">{formatCurrency(m.tranche_amount)}</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="p-2.5 rounded-lg bg-white border border-warmgray-200 space-y-1">
                          <span className="font-bold text-warmgray-800 block text-[11px]">Submissions &amp; Field Proofs</span>
                          <span className="text-warmgray-600">{m.submissions.length} proof submission(s) recorded</span>
                        </div>

                        <div className="p-2.5 rounded-lg bg-white border border-warmgray-200 space-y-1">
                          <span className="font-bold text-warmgray-800 block text-[11px]">AI Verification Decisions</span>
                          {m.decisions.length > 0 ? (
                            <span className="text-warmgray-600">Decision: <strong>{m.decisions[0].decision.toUpperCase()}</strong> ({m.decisions[0].explanation.slice(0, 45)}...)</span>
                          ) : (
                            <span className="text-warmgray-400">Awaiting evaluation</span>
                          )}
                        </div>

                        <div className="p-2.5 rounded-lg bg-white border border-warmgray-200 space-y-1">
                          <span className="font-bold text-warmgray-800 block text-[11px]">PayPal Payout Settlement</span>
                          {m.payouts.length > 0 ? (
                            <span className="text-warmgray-600">Batch: <strong>{m.payouts[0].sender_batch_id}</strong> ({m.payouts[0].status})</span>
                          ) : (
                            <span className="text-warmgray-400">No payout dispatched yet</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
