/* ImpactRelease Frontend + AG Grid Console */
const state = {
  projects: [],
  users: [],
  currentDraft: null,
  activeChallenge: null,
  reviewGridApi: null,
  ledgerGridApi: null,
  selectedReviewRow: null,
};

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.style.display = "none";
  }, 3800);
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || `HTTP ${res.status}`);
  }
  return data;
}

function statusBadge(status) {
  const ok = ["FUNDED", "COMPLETED", "SETTLED", "VERIFIED", "APPROVED_FOR_RELEASE", "SUCCESS", "ANALYZED"];
  const warn = ["PENDING", "EVIDENCE_SUBMITTED", "CHALLENGE_WINDOW", "PAYOUT_SENT"];
  const cls = ok.includes(status) ? "ok" : warn.includes(status) ? "warn" : "err";
  return `<span class="badge ${cls}">${status}</span>`;
}

/* ---------- Tabs ---------- */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

/* ---------- AG Grid Setup ---------- */
function initGrids() {
  const reviewEl = document.getElementById("reviewGrid");
  const ledgerEl = document.getElementById("ledgerGrid");
  if (!window.agGrid) {
    reviewEl.innerHTML = "<p style='padding:1rem;'>AG Grid CDN not loaded; using standard view.</p>";
    return;
  }

  const reviewOptions = {
    columnDefs: [
      { field: "milestone_id", headerName: "ID", width: 80 },
      { field: "project_id", headerName: "Project", width: 95 },
      { field: "title", headerName: "Milestone", flex: 1.4, filter: true },
      {
        field: "tranche_amount",
        headerName: "Amount",
        width: 115,
        valueFormatter: (p) => `$${Number(p.value || 0).toFixed(2)}`,
      },
      { field: "status", headerName: "Status", width: 145 },
      {
        field: "skeptic_risk",
        headerName: "Skeptic Fraud Risk",
        width: 160,
        valueFormatter: (p) => `${Math.round((p.value || 0) * 100)}%`,
        cellStyle: (p) =>
          p.value >= 0.65
            ? { fontWeight: "700", color: "#991b1b", backgroundColor: "#fee2e2" }
            : { fontWeight: "600", color: "#92400e" },
      },
      {
        headerName: "Flags / Disputes",
        flex: 1.5,
        valueGetter: (p) => {
          const c = (p.data.concerns || []).map((x) => x.code).join(", ");
          const d = (p.data.open_disputes || []).map((x) => `DISPUTE: ${x.reason}`).join("; ");
          return [c, d].filter(Boolean).join(" | ") || "Manual threshold review";
        },
      },
    ],
    rowData: [],
    rowSelection: "single",
    onRowClicked: (e) => renderSelectedReviewItem(e.data),
  };

  const ledgerOptions = {
    columnDefs: [
      { field: "payout_id", headerName: "Payout #", width: 95 },
      { field: "project_id", headerName: "Project #", width: 100 },
      { field: "milestone", headerName: "Milestone", flex: 1.2, filter: true },
      {
        field: "amount",
        headerName: "Amount",
        width: 120,
        valueFormatter: (p) => `$${Number(p.value || 0).toFixed(2)} ${p.data.currency || "USD"}`,
      },
      { field: "status", headerName: "PayPal Status", width: 135 },
      {
        field: "is_holdback",
        headerName: "Type",
        width: 115,
        valueFormatter: (p) => (p.value ? "Holdback" : "Tranche"),
      },
      { field: "reason", headerName: "Plain-Language AI Release Reason", flex: 2.2, filter: true },
      { field: "created_at", headerName: "Timestamp", width: 185 },
    ],
    rowData: [],
  };

  state.reviewGridApi = agGrid.createGrid(reviewEl, reviewOptions);
  state.ledgerGridApi = agGrid.createGrid(ledgerEl, ledgerOptions);

  document.getElementById("ledgerFilterInput").addEventListener("input", (e) => {
    if (state.ledgerGridApi) {
      state.ledgerGridApi.setGridOption("quickFilterText", e.target.value);
    }
  });
  document.getElementById("btnExportLedgerCsv").addEventListener("click", () => {
    if (state.ledgerGridApi) {
      state.ledgerGridApi.exportDataAsCsv({ fileName: "impactrelease-public-ledger.csv" });
    }
  });
}

function renderSelectedReviewItem(row) {
  state.selectedReviewRow = row;
  const panel = document.getElementById("selectedReviewPanel");
  if (!row) {
    panel.innerHTML = "";
    return;
  }
  const concernsHtml = (row.concerns || [])
    .map((c) => `<li><strong>${c.code}</strong> (severity ${c.severity}): ${c.detail}</li>`)
    .join("");
  const disputesHtml = (row.open_disputes || [])
    .map((d) => `<li><strong>${d.raised_by}:</strong> ${d.reason}</li>`)
    .join("");
  panel.innerHTML = `
    <div class="milestone-item">
      <div class="head">
        <span>Inspecting Milestone #${row.milestone_id}: ${row.title} ($${row.tranche_amount.toFixed(2)})</span>
        ${statusBadge(row.status)}
      </div>
      <p style="font-size:0.85rem;margin:0.5rem 0 0.25rem;"><strong>Skeptic Concerns:</strong></p>
      <ul>${concernsHtml || "<li>None</li>"}</ul>
      <p style="font-size:0.85rem;margin:0.5rem 0 0.25rem;"><strong>Open Disputes:</strong></p>
      <ul>${disputesHtml || "<li>None</li>"}</ul>
      <label for="reviewCommentInput">Reviewer Audit Note</label>
      <input id="reviewCommentInput" type="text" value="Reviewed evidence and confirmed resolution with field team." />
      <div class="btn-row">
        <button class="btn" onclick="submitReviewDecision(${row.milestone_id}, 'approve')">Approve &amp; Clear for Release</button>
        <button class="btn danger" onclick="submitReviewDecision(${row.milestone_id}, 'reject')">Reject Milestone</button>
      </div>
    </div>
  `;
}

window.submitReviewDecision = async function (milestoneId, decision) {
  const comment = document.getElementById("reviewCommentInput")?.value || "";
  try {
    await api(`/review/${milestoneId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewer: "senior-auditor", decision, comment }),
    });
    toast(`Milestone #${milestoneId} marked ${decision}.`);
    await refreshAll();
  } catch (err) {
    toast(`Error: ${err.message}`);
  }
};

/* ---------- Canvas Proof Generator ---------- */
function renderProofCanvas() {
  const canvas = document.getElementById("captureCanvas");
  const ctx = canvas.getContext("2d");
  const code = state.activeChallenge ? state.activeChallenge.code : "------";
  const includeCode = document.getElementById("stampCodeToggle").checked;
  const amount = Number(document.getElementById("receiptAmountInput").value || 0).toFixed(2);
  const mid = Number(document.getElementById("ngoMilestoneSelect").value || 1);

  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < canvas.width; i += 24) {
    ctx.fillStyle = `rgb(${(i * 19 + mid * 41) % 220}, ${(i * 11 + mid * 23) % 200}, ${(i * 29) % 230})`;
    ctx.fillRect(i, 20 + ((i / 3) % 40), 16, 130);
  }

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(14, 14, 332, 54);
  ctx.fillStyle = "#5eead4";
  ctx.font = "bold 16px monospace";
  ctx.fillText(
    includeCode ? `CHALLENGE CODE: ${code}` : "NO CHALLENGE PLACARD IN FRAME",
    24,
    46
  );

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(14, 152, 332, 52);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText(`Milestone #${mid} Field Proof | Receipt Total: $${amount}`, 22, 183);
}

/* ---------- Data Loading ---------- */
async function ensureDefaultUsers() {
  let users = await api("/users");
  if (!users.length) {
    await api("/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "donor", name: "Community Donor", email: "donor@impactrelease.org" }),
    });
    await api("/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "ngo",
        name: "Field NGO Partner",
        email: "ngo@impactrelease.org",
        paypal_email: "ngo-payee@sandbox.paypal.com",
      }),
    });
    users = await api("/users");
  }
  state.users = users;
}

async function refreshAll() {
  try {
    const [projects, reviewQueue, ledger, audit] = await Promise.all([
      api("/projects"),
      api("/review/queue"),
      api("/ledger/public"),
      api("/audit"),
    ]);
    state.projects = projects;

    const totalFunded = projects.reduce((acc, p) => acc + (p.funded || 0), 0);
    const totalReleased = projects.reduce((acc, p) => acc + (p.released || 0), 0);
    document.getElementById("kpiProjects").textContent = projects.length;
    document.getElementById("kpiFunded").textContent = `$${totalFunded.toFixed(2)}`;
    document.getElementById("kpiReleased").textContent = `$${totalReleased.toFixed(2)}`;
    document.getElementById("kpiReviewCount").textContent = reviewQueue.length;

    populateProjectAndMilestoneSelects(projects);

    if (state.reviewGridApi) {
      state.reviewGridApi.setGridOption("rowData", reviewQueue);
    }
    if (reviewQueue.length) {
      renderSelectedReviewItem(reviewQueue[0]);
    } else {
      renderSelectedReviewItem(null);
    }

    if (state.ledgerGridApi) {
      state.ledgerGridApi.setGridOption("rowData", ledger);
    }

    document.getElementById("auditLogBox").textContent = audit
      .slice(0, 35)
      .map((a) => `[${a.created_at}] ${a.actor} -> ${a.action} (${a.entity}#${a.entity_id}) ${a.details_json}`)
      .join("\n");
  } catch (err) {
    toast(`Refresh failed: ${err.message}`);
  }
}

function populateProjectAndMilestoneSelects(projects) {
  const projSel = document.getElementById("projectSelect");
  const prevProj = projSel.value;
  projSel.innerHTML = projects
    .map(
      (p) =>
        `<option value="${p.project.id}">Project #${p.project.id} — $${p.project.total_amount.toFixed(2)} (${p.project.status})</option>`
    )
    .join("");
  if (prevProj && [...projSel.options].some((o) => o.value === prevProj)) {
    projSel.value = prevProj;
  }
  renderSelectedProject();

  const allMilestones = [];
  projects.forEach((p) => {
    p.milestones.forEach((m) => {
      allMilestones.push({ project: p.project, milestone: m });
    });
  });

  const msHtml = allMilestones
    .map(
      ({ project, milestone }) =>
        `<option value="${milestone.id}" data-amount="${milestone.tranche_amount}" data-payee="${milestone.payee_user_id}">P#${project.id} M${milestone.order_no}: ${milestone.title} ($${milestone.tranche_amount.toFixed(2)} — ${milestone.status})</option>`
    )
    .join("");

  ["ngoMilestoneSelect", "confirmMilestoneSelect"].forEach((id) => {
    const sel = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = msHtml;
    if (prev && [...sel.options].some((o) => o.value === prev)) {
      sel.value = prev;
    }
  });
  renderProofCanvas();
}

function renderSelectedProject() {
  const pid = Number(document.getElementById("projectSelect").value);
  const entry = state.projects.find((p) => p.project.id === pid);
  const box = document.getElementById("projectDetails");
  if (!entry) {
    box.innerHTML = "<p style='color:var(--muted);font-size:0.88rem;'>No projects yet. Click 'Load Demo Scenario' or draft one on the left.</p>";
    return;
  }
  const { project, milestones, funded, released } = entry;
  box.innerHTML = `
    <div style="margin-bottom:0.65rem;font-size:0.88rem;">
      <div><strong>Intent:</strong> ${project.intent_text}</div>
      <div style="margin-top:0.3rem;">
        Status: ${statusBadge(project.status)} |
        Funded: <strong>$${funded.toFixed(2)}</strong> |
        Released: <strong>$${released.toFixed(2)}</strong> |
        Holdback: <strong>${project.holdback_pct}%</strong>
      </div>
    </div>
    ${milestones
      .map(
        (m) => `
      <div class="milestone-item">
        <div class="head">
          <span>#${m.order_no} ${m.title} — $${m.tranche_amount.toFixed(2)}</span>
          ${statusBadge(m.status)}
        </div>
        <div style="font-size:0.82rem;color:var(--muted);margin-top:0.2rem;">${m.description || ""}</div>
      </div>`
      )
      .join("")}
  `;
}

document.getElementById("projectSelect").addEventListener("change", renderSelectedProject);
document.getElementById("ngoMilestoneSelect").addEventListener("change", (e) => {
  const opt = e.target.selectedOptions[0];
  if (opt && opt.dataset.amount) {
    document.getElementById("receiptAmountInput").value = opt.dataset.amount;
  }
  renderProofCanvas();
});
document.getElementById("confirmMilestoneSelect").addEventListener("change", (e) => {
  const opt = e.target.selectedOptions[0];
  if (opt && opt.dataset.amount) {
    document.getElementById("confirmReportedAmount").value = opt.dataset.amount;
  }
});

/* ---------- Actions ---------- */
document.getElementById("btnSeedDemo").addEventListener("click", async () => {
  try {
    toast("Seeding showcase project, AI analyses, and PayPal payouts...");
    await api("/demo/seed", { method: "POST" });
    await refreshAll();
    toast("Demo scenario loaded! Explore all 5 tabs.");
  } catch (err) {
    toast(`Seed error: ${err.message}`);
  }
});

document.getElementById("btnRefreshAll").addEventListener("click", refreshAll);

document.getElementById("btnDraftContract").addEventListener("click", async () => {
  const intent_text = document.getElementById("donorIntent").value;
  const budget = Number(document.getElementById("donorBudget").value);
  const holdback_pct = Number(document.getElementById("donorHoldback").value);
  try {
    toast("Contract Agent drafting verifiable milestones...");
    const draft = await api("/projects/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent_text, budget, currency: "USD", holdback_pct }),
    });
    state.currentDraft = { ...draft, intent_text };
    document.getElementById("draftMeta").innerHTML = `
      Source: <span class="badge info">${draft.source.toUpperCase()}</span> |
      Holdback reserved: <strong>$${draft.holdback_amount.toFixed(2)}</strong>
      ${draft.clarifying_questions?.length ? `<div style="margin-top:0.35rem;"><strong>Clarifying Questions:</strong> ${draft.clarifying_questions.join(" • ")}</div>` : ""}
    `;
    document.getElementById("draftMilestones").innerHTML = draft.milestones
      .map(
        (m) => `
      <div class="milestone-item">
        <div class="head">
          <span>${m.order_no}. ${m.title}</span>
          <span>$${m.tranche_amount.toFixed(2)}</span>
        </div>
        <ul>${m.evidence_requirements.map((r) => `<li>${r}</li>`).join("")}</ul>
      </div>`
      )
      .join("");
    document.getElementById("approveContractRow").style.display = "flex";
    toast("Draft ready! Review and click 'Approve Contract & Fund via PayPal'.");
  } catch (err) {
    toast(`Draft failed: ${err.message}`);
  }
});

document.getElementById("btnApproveAndFund").addEventListener("click", async () => {
  if (!state.currentDraft) return;
  try {
    await ensureDefaultUsers();
    const donor = state.users.find((u) => u.role === "donor") || state.users[0];
    const ngo = state.users.find((u) => u.role === "ngo") || state.users[state.users.length - 1];
    const d = state.currentDraft;
    const created = await api("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        donor_id: donor.id,
        org_id: ngo.id,
        intent_text: d.intent_text,
        total_amount: d.budget,
        currency: d.currency,
        holdback_pct: d.holdback_pct,
        milestones: d.milestones.map((m) => ({
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
    toast(`Project #${pid} created and funded via PayPal!`);
    await refreshAll();
  } catch (err) {
    toast(`Funding failed: ${err.message}`);
  }
});

document.getElementById("btnReleaseHoldback").addEventListener("click", async () => {
  const pid = Number(document.getElementById("projectSelect").value);
  if (!pid) return;
  try {
    const payout = await api(`/projects/${pid}/release-holdback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: "donor" }),
    });
    toast(`Holdback released ($${payout.amount.toFixed(2)})!`);
    await refreshAll();
  } catch (err) {
    toast(`Holdback blocked: ${err.message}`);
  }
});

document.getElementById("btnIssueChallenge").addEventListener("click", async () => {
  const sel = document.getElementById("ngoMilestoneSelect");
  const mid = Number(sel.value);
  const payeeId = Number(sel.selectedOptions[0]?.dataset.payee || 2);
  if (!mid) return;
  try {
    const ch = await api(`/milestones/${mid}/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: payeeId }),
    });
    state.activeChallenge = ch;
    document.getElementById("challengeBanner").style.display = "flex";
    document.getElementById("challengeCodeDisplay").textContent = ch.code;
    document.getElementById("challengeIdDisplay").textContent = ch.challenge_id;
    document.getElementById("challengeExpiryDisplay").textContent = `Expires: ${new Date(ch.expires_at).toLocaleTimeString()}`;
    renderProofCanvas();
    toast(`Issued Challenge Code ${ch.code}`);
  } catch (err) {
    toast(`Challenge error: ${err.message}`);
  }
});

document.getElementById("btnRenderProof").addEventListener("click", renderProofCanvas);
document.getElementById("stampCodeToggle").addEventListener("change", renderProofCanvas);
document.getElementById("receiptAmountInput").addEventListener("input", renderProofCanvas);

document.getElementById("btnSubmitEvidence").addEventListener("click", async () => {
  const sel = document.getElementById("ngoMilestoneSelect");
  const mid = Number(sel.value);
  const payeeId = Number(sel.selectedOptions[0]?.dataset.payee || 2);
  if (!mid) return;
  if (!state.activeChallenge) {
    toast("Please issue a 1-Time Challenge Code in Step 1 first.");
    return;
  }
  renderProofCanvas();
  const canvas = document.getElementById("captureCanvas");
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  const arrBuf = await blob.arrayBuffer();
  const includeCode = document.getElementById("stampCodeToggle").checked;
  const amount = Number(document.getElementById("receiptAmountInput").value || 0).toFixed(2);
  const trailer = `\n${includeCode ? `Challenge ${state.activeChallenge.code}` : "No code"} | Receipt Total: $${amount}`;
  const combined = new Blob([arrBuf, new TextEncoder().encode(trailer)], { type: "image/png" });

  const fd = new FormData();
  fd.append("challenge_id", state.activeChallenge.challenge_id);
  fd.append("submitted_by", payeeId);
  fd.append("captured_at", new Date().toISOString());
  fd.append("capture_source", "in_app_camera");
  fd.append("lat", "18.5204");
  fd.append("lng", "73.8567");
  fd.append("device", JSON.stringify({ model: "ImpactRelease PWA Camera" }));
  fd.append("files", combined, `milestone_${mid}_proof.png`);

  try {
    toast("Uploading evidence & running Verifier + Skeptic agents...");
    const sub = await api(`/milestones/${mid}/submissions`, { method: "POST", body: fd });
    const analysis = await api(`/submissions/${sub.submission_id}/analyze`, { method: "POST" });
    renderAnalysisReport(analysis);
    state.activeChallenge = null;
    await refreshAll();
    toast(`Analysis complete: ${analysis.milestone_status}`);
  } catch (err) {
    toast(`Submission failed: ${err.message}`);
  }
});

function renderAnalysisReport(a) {
  const box = document.getElementById("analysisOutput");
  const v = a.verifier || {};
  const s = a.skeptic || {};
  box.innerHTML = `
    <div class="milestone-item">
      <div class="head">
        <span>Submission #${a.submission_id} (Milestone #${a.milestone_id})</span>
        ${statusBadge(a.milestone_status)}
      </div>
      <p style="font-size:0.86rem;margin:0.5rem 0;">
        <strong>Verifier Agent (${v.source}):</strong>
        Challenge Code Visible: <span class="badge ${v.challenge_code_visible ? "ok" : "err"}">${v.challenge_code_visible ? "YES" : "NO"}</span> |
        Confidence: <strong>${Math.round((v.confidence || 0) * 100)}%</strong>
      </p>
      <div style="font-size:0.83rem;color:var(--muted);">${v.explanation || ""}</div>
      <hr style="border:none;border-top:1px solid var(--border);margin:0.65rem 0;" />
      <p style="font-size:0.86rem;margin:0.35rem 0;">
        <strong>Adversarial Skeptic Agent (${s.source}):</strong>
        Fraud Risk: <span class="badge ${s.fraud_risk >= 0.65 ? "err" : s.fraud_risk >= 0.4 ? "warn" : "ok"}">${Math.round((s.fraud_risk || 0) * 100)}%</span>
        (Deterministic Floor: ${Math.round((s.rule_risk_floor || 0) * 100)}%) |
        Recommendation: <strong>${(s.recommendation || "").toUpperCase()}</strong>
      </p>
      <ul>${(s.concerns || []).map((c) => `<li><strong>${c.code}:</strong> ${c.detail}</li>`).join("") || "<li>No anomalies flagged</li>"}</ul>
    </div>
  `;
}

document.getElementById("btnCreateInvite").addEventListener("click", async () => {
  const mid = Number(document.getElementById("confirmMilestoneSelect").value);
  const kind = document.getElementById("confirmKind").value;
  const contact_ref = document.getElementById("confirmContact").value;
  if (!mid) return;
  try {
    const res = await api(`/milestones/${mid}/confirmations/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, contact_ref }),
    });
    document.getElementById("confirmTokenInput").value = res.token;
    toast(`Invite token generated for ${kind}!`);
  } catch (err) {
    toast(`Invite failed: ${err.message}`);
  }
});

document.getElementById("btnSubmitConfirmation").addEventListener("click", async () => {
  const token = document.getElementById("confirmTokenInput").value.trim();
  if (!token) {
    toast("Generate or paste an invite token first.");
    return;
  }
  const confirmed = document.getElementById("confirmDecisionSelect").value === "true";
  const reported_amount = Number(document.getElementById("confirmReportedAmount").value);
  const free_text = document.getElementById("confirmFreeText").value;
  try {
    const res = await api(`/confirm/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed, reported_amount, free_text }),
    });
    toast(
      res.matched
        ? "Confirmation verified and matched!"
        : `Confirmation flagged: ${(res.flags || []).map((f) => f.flag).join(", ")}`
    );
    await refreshAll();
  } catch (err) {
    toast(`Confirm error: ${err.message}`);
  }
});

document.getElementById("btnEvaluateRules").addEventListener("click", async () => {
  const mid = Number(document.getElementById("confirmMilestoneSelect").value);
  if (!mid) return;
  try {
    const dec = await api(`/milestones/${mid}/decision`, { method: "POST" });
    const checks = dec.rules?.checks || {};
    document.getElementById("decisionOutput").innerHTML = `
      <div class="milestone-item">
        <div class="head">
          <span>Decision: ${dec.decision.toUpperCase()}</span>
          ${statusBadge(dec.milestone_status)}
        </div>
        <p style="font-size:0.84rem;margin:0.45rem 0;">${dec.explanation}</p>
        <ul>
          ${Object.entries(checks)
            .map(
              ([k, v]) =>
                `<li><span class="badge ${v.passed ? "ok" : "err"}">${v.passed ? "PASS" : "FAIL"}</span> <strong>${k}:</strong> ${v.detail}</li>`
            )
            .join("")}
        </ul>
      </div>
    `;
    await refreshAll();
  } catch (err) {
    toast(`Evaluation error: ${err.message}`);
  }
});

document.getElementById("btnExecutePayout").addEventListener("click", async () => {
  const mid = Number(document.getElementById("confirmMilestoneSelect").value);
  if (!mid) return;
  try {
    const p = await api(`/payouts/${mid}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: "release_agent", human_approved: true }),
    });
    toast(`PayPal Payout sent ($${p.amount.toFixed(2)}, batch ${p.paypal_batch_id})!`);
    await refreshAll();
  } catch (err) {
    toast(`Payout blocked: ${err.message}`);
  }
});

document.getElementById("btnRaiseDispute").addEventListener("click", async () => {
  const mid = Number(document.getElementById("confirmMilestoneSelect").value);
  const reason = document.getElementById("disputeReasonInput").value;
  if (!mid) return;
  try {
    await api(`/milestones/${mid}/dispute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raised_by: "Community Witness", reason }),
    });
    toast(`Dispute raised on Milestone #${mid}. Routed to Reviewer Console.`);
    await refreshAll();
  } catch (err) {
    toast(`Dispute error: ${err.message}`);
  }
});

/* ---------- Boot ---------- */
window.addEventListener("DOMContentLoaded", async () => {
  initGrids();
  await refreshAll();
});
