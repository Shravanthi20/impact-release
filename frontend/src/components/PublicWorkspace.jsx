import React, { useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { Globe, Download, Search, ShieldCheck } from "lucide-react";
import { formatCurrency, formatDateTime } from "../api.js";
import AuditTimeline from "./AuditTimeline.jsx";

export default function PublicWorkspace({ ledger = [], audit = [] }) {
  const gridRef = useRef(null);
  const [quickFilter, setQuickFilter] = useState("");

  const columnDefs = useMemo(
    () => [
      {
        field: "payout_id",
        headerName: "Payout",
        maxWidth: 95,
        valueFormatter: (p) => `#${p.value}`,
      },
      {
        field: "project_id",
        headerName: "Grant",
        maxWidth: 95,
        valueFormatter: (p) => `Grant #${p.value}`,
      },
      {
        field: "milestone",
        headerName: "Verified Milestone Deliverable",
        flex: 1.4,
        minWidth: 190,
      },
      {
        field: "amount",
        headerName: "Disbursed",
        maxWidth: 120,
        valueFormatter: (p) => formatCurrency(p.value, p.data?.currency),
      },
      {
        field: "status",
        headerName: "PayPal Status",
        maxWidth: 135,
      },
      {
        field: "reason",
        headerName: "Release Audit Justification",
        flex: 1.8,
        minWidth: 230,
      },
      {
        field: "created_at",
        headerName: "Disbursed At",
        maxWidth: 175,
        valueFormatter: (p) => formatDateTime(p.value),
      },
    ],
    []
  );

  function handleExportCsv() {
    if (gridRef.current?.api) {
      gridRef.current.api.exportDataAsCsv({
        fileName: "impactrelease-public-ledger.csv",
      });
    }
  }

  return (
    <div className="space-y-6">
      {/* Public Ledger Card */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-teal-700" />
              <h2 className="text-base font-bold text-slate-900">
                Public Proof-of-Impact Disbursement Ledger (Zero-PII)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Every settled PayPal tranche disbursement, verified milestone deliverable, and release audit justification.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={quickFilter}
                onChange={(e) => setQuickFilter(e.target.value)}
                placeholder="Filter public ledger..."
                className="pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 w-56"
              />
            </div>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white transition"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        <div
          id="ledgerGrid"
          className="ag-theme-quartz w-full"
          style={{ height: 300 }}
        >
          <AgGridReact
            ref={gridRef}
            rowData={ledger}
            columnDefs={columnDefs}
            quickFilterText={quickFilter}
            overlayNoRowsTemplate="<span class='text-xs text-slate-500'>No public ledger entries yet. Click 'Load Sample Portfolio' in the top bar or release a milestone.</span>"
          />
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500 pt-1">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            Beneficiary identities, email addresses, and raw student photos are redacted from the public ledger to protect privacy.
          </span>
        </div>
      </div>

      {/* Human-Readable Audit Log */}
      <AuditTimeline audit={audit} />
    </div>
  );
}
