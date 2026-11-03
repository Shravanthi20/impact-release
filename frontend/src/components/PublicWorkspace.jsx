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
        headerName: "Verified Deliverable",
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
        headerName: "Disbursement Status",
        maxWidth: 140,
      },
      {
        field: "reason",
        headerName: "Verification Audit Reason",
        flex: 1.8,
        minWidth: 230,
      },
      {
        field: "created_at",
        headerName: "Settlement Time",
        maxWidth: 175,
        valueFormatter: (p) => formatDateTime(p.value),
      },
    ],
    []
  );

  function handleExportCsv() {
    if (gridRef.current?.api) {
      gridRef.current.api.exportDataAsCsv({
        fileName: "impactrelease-transparency-ledger.csv",
      });
    }
  }

  return (
    <div className="space-y-6">
      {/* Public Ledger Header */}
      <div className="bg-gradient-to-r from-forest-950 via-warmgray-900 to-warmgray-900 text-white rounded-2xl p-6 shadow-sm border border-forest-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-forest-300 text-xs font-bold uppercase tracking-wider">
            <Globe className="w-4 h-4 text-forest-400" />
            <span>Open Public Ledger (Zero-PII)</span>
          </div>
          <h1 className="text-xl font-bold font-serif">
            Public Proof-of-Impact &amp; Settlement Log
          </h1>
          <p className="text-xs text-warmgray-300">
            Cryptographic proof digests, third-party attestations, and settled payouts visible to all community stakeholders.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-forest-700 hover:bg-forest-600 text-white transition cursor-pointer shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            Export Ledger CSV
          </button>
        </div>
      </div>

      {/* AG Grid Public Table */}
      <div className="bg-white border border-warmgray-200 rounded-2xl shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-warmgray-100">
          <h2 className="text-sm font-bold text-warmgray-900 font-serif">
            Verified Milestone Payouts
          </h2>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-warmgray-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={quickFilter}
              onChange={(e) => setQuickFilter(e.target.value)}
              placeholder="Filter ledger entries..."
              className="pl-8 pr-3 py-1.5 text-xs border border-warmgray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-forest-600 w-52"
            />
          </div>
        </div>

        <div
          id="ledgerGrid"
          className="ag-theme-quartz w-full"
          style={{ height: 280 }}
        >
          <AgGridReact
            ref={gridRef}
            rowData={ledger}
            columnDefs={columnDefs}
            quickFilterText={quickFilter}
            overlayNoRowsTemplate="<span class='text-xs text-warmgray-500'>No public disbursements yet recorded.</span>"
          />
        </div>

        <div className="flex items-center gap-2 text-xs text-warmgray-500 pt-1">
          <ShieldCheck className="w-4 h-4 text-forest-700 shrink-0" />
          <span>
            Beneficiary names and raw patient/student imagery are strictly redacted from the open ledger to safeguard privacy.
          </span>
        </div>
      </div>

      {/* Human-Readable Security Audit Trail */}
      <AuditTimeline audit={audit} />
    </div>
  );
}
