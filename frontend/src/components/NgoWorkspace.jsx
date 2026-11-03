import React, { useEffect, useRef, useState } from "react";
import {
  Camera,
  Upload,
  KeyRound,
  ShieldCheck,
  Banknote,
  MapPin,
  Sparkles,
  FileCheck2,
  UserPlus,
} from "lucide-react";
import { api, formatCurrency, statusBadgeClass } from "../api.js";

function generateFieldReceiptBlob(code, amount, milestoneTitle) {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 420;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#e7e2d8";
    ctx.fillRect(0, 0, 640, 420);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(32, 28, 350, 364);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.strokeRect(32, 28, 350, 364);

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 20px Inter, Arial, sans-serif";
    ctx.fillText("PUNE EDUCATIONAL SUPPLIERS", 52, 68);

    ctx.fillStyle = "#475569";
    ctx.font = "13px Inter, Arial, sans-serif";
    ctx.fillText("GSTIN: 27AABCP9912K1Z5  |  Tax Invoice", 52, 92);
    ctx.fillText(
      `Milestone: ${(milestoneTitle || "Grant Delivery").slice(0, 32)}`,
      52,
      118
    );

    ctx.strokeStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(52, 134);
    ctx.lineTo(362, 134);
    ctx.stroke();

    ctx.fillStyle = "#1e293b";
    ctx.font = "14px Inter, Arial, sans-serif";
    ctx.fillText("1. Student Textbooks & Learning Kits", 52, 166);
    ctx.fillText("2. Verified School Attendance Registers", 52, 194);
    ctx.fillText("3. Direct Beneficiary Delivery Sign-off", 52, 222);

    ctx.fillStyle = "#f0fdf4";
    ctx.fillRect(52, 256, 310, 64);
    ctx.strokeStyle = "#16a34a";
    ctx.strokeRect(52, 256, 310, 64);

    ctx.fillStyle = "#15803d";
    ctx.font = "bold 22px Inter, Arial, sans-serif";
    ctx.fillText(`TOTAL PAID: $${Number(amount || 300).toFixed(2)}`, 68, 296);

    ctx.fillStyle = "#64748b";
    ctx.font = "12px Inter, Arial, sans-serif";
    ctx.fillText("Paid via Verified NGO Disbursement Account", 52, 356);

    // Handwritten challenge placard held next to invoice
    ctx.fillStyle = "#fef9c3";
    ctx.fillRect(404, 70, 206, 220);
    ctx.strokeStyle = "#ca8a04";
    ctx.lineWidth = 3;
    ctx.strokeRect(404, 70, 206, 220);

    ctx.fillStyle = "#713f12";
    ctx.font = "bold 13px Inter, Arial, sans-serif";
    ctx.fillText("LIVE FIELD CHALLENGE", 426, 108);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 36px monospace";
    ctx.fillText(String(code || "000000"), 438, 168);

    ctx.fillStyle = "#854d0e";
    ctx.font = "12px Inter, Arial, sans-serif";
    ctx.fillText("In-App Field Verification", 432, 212);
    ctx.fillText(new Date().toISOString().slice(0, 10), 462, 236);

    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

export default function NgoWorkspace({
  projects = [],
  users = [],
  onRefresh,
  notify,
  onInviteCreated,
}) {
  const allMilestones = projects.flatMap((entry) =>
    entry.milestones.map((m) => ({
      ...m,
      projectIntent: entry.project.intent_text,
      projectStatus: entry.project.status,
    }))
  );

  const [selectedMilestoneId, setSelectedMilestoneId] = useState(
    allMilestones[0]?.id || ""
  );
  const activeMilestone =
    allMilestones.find((m) => m.id === Number(selectedMilestoneId)) ||
    allMilestones[0];

  const [challenge, setChallenge] = useState(null);
  const [captureMode, setCaptureMode] = useState("upload");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [notes, setNotes] = useState(
    "Delivered textbooks and verified school fee receipts with school principal on-site."
  );
  const [gps, setGps] = useState({ lat: 18.5204, lon: 73.8567 });
  const [submitting, setSubmitting] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [decisionResult, setDecisionResult] = useState(null);
  const [confirmations, setConfirmations] = useState([]);
  const [invites, setInvites] = useState([]);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);

  useEffect(() => {
    if (!selectedMilestoneId && allMilestones[0]?.id) {
      setSelectedMilestoneId(allMilestones[0].id);
    }
  }, [allMilestones, selectedMilestoneId]);

  useEffect(() => {
    if (activeMilestone?.id) {
      loadConfirmations(activeMilestone.id);
    }
  }, [activeMilestone?.id]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  function getNgoUserId() {
    const ngo = users.find((u) => u.role === "ngo") || users[0];
    return ngo?.id || activeMilestone?.payee_user_id || 2;
  }

  async function loadConfirmations(milestoneId) {
    try {
      const data = await api(`/milestones/${milestoneId}/confirmations`);
      setConfirmations(Array.isArray(data) ? data : []);
    } catch {
      setConfirmations([]);
    }
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch (err) {
      notify(
        `Camera access unavailable (${err.message}). Use file upload or sample receipt generator.`,
        "error"
      );
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }

  function captureCameraFrame() {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `field-camera-${Date.now()}.png`, {
          type: "image/png",
        });
        setSelectedFiles((prev) => [...prev, file]);
        notify("Captured live camera frame for verification.");
      }
    }, "image/png");
  }

  async function handleIssueChallenge() {
    if (!activeMilestone) return null;
    try {
      const ch = await api(`/milestones/${activeMilestone.id}/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: getNgoUserId() }),
      });
      setChallenge(ch);
      notify(
        `Issued 1-time field verification code ${ch.code} for Milestone #${activeMilestone.id}.`
      );
      await onRefresh();
      return ch;
    } catch (err) {
      notify(`Could not issue challenge code: ${err.message}`, "error");
      return null;
    }
  }

  async function handleAttachSampleReceipt() {
    if (!activeMilestone) return;
    let activeChallenge = challenge;
    if (!activeChallenge) {
      activeChallenge = await handleIssueChallenge();
    }
    const activeCode = activeChallenge?.code || "123456";
    const blob = await generateFieldReceiptBlob(
      activeCode,
      activeMilestone.tranche_amount,
      activeMilestone.title
    );
    const file = new File(
      [blob],
      `field-receipt-m${activeMilestone.id}-${activeCode}.png`,
      { type: "image/png" }
    );
    setSelectedFiles([file]);
    notify(
      `Prepared sample field invoice & placard photo with code ${activeCode} ($${activeMilestone.tranche_amount}).`
    );
  }

  function handleDetectGps() {
    if (!navigator.geolocation) {
      notify("Browser geolocation not supported; using Pune field coordinates.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: Number(pos.coords.latitude.toFixed(5)),
          lon: Number(pos.coords.longitude.toFixed(5)),
        });
        notify("Updated GPS coordinates from device location.");
      },
      () => {
        notify("Using default field site coordinates (18.5204, 73.8567).");
      }
    );
  }

  async function handleSubmitAndAnalyze(e) {
    e.preventDefault();
    if (!activeMilestone) return;
    if (selectedFiles.length === 0) {
      notify(
        "Please upload a photo/receipt or click 'Attach Sample Field Receipt' first.",
        "error"
      );
      return;
    }
    setSubmitting(true);
    try {
      let activeChallenge = challenge;
      if (!activeChallenge) {
        activeChallenge = await handleIssueChallenge();
      }
      if (!activeChallenge?.challenge_id) {
        throw new Error("Could not obtain a valid challenge code.");
      }

      const fd = new FormData();
      fd.append("challenge_id", String(activeChallenge.challenge_id));
      fd.append("submitted_by", String(getNgoUserId()));
      fd.append("captured_at", new Date().toISOString());
      fd.append("capture_source", "in_app_camera");
      fd.append("lat", String(gps.lat));
      fd.append("lng", String(gps.lon));
      fd.append("accuracy_m", "5.0");
      fd.append(
        "device",
        JSON.stringify({
          device_id: "ngo-field-tablet-pune-01",
          notes,
        })
      );
      selectedFiles.forEach((f) => fd.append("files", f, f.name));

      notify(
        "Uploading field evidence and running SHA-256 + dHash duplicate checks..."
      );
      const sub = await api(`/milestones/${activeMilestone.id}/submissions`, {
        method: "POST",
        body: fd,
      });

      notify(
        "Inspecting evidence with Gemini Multimodal Verifier & Skeptic Agents..."
      );
      const analysis = await api(`/submissions/${sub.submission_id}/analyze`, {
        method: "POST",
      });
      setAnalysisResult(analysis);
      setChallenge(null); // Challenge is one-time use
      await onRefresh();
      notify(
        `Gemini verification complete: confidence ${(
          (analysis.verifier?.confidence || 0) * 100
        ).toFixed(0)}%, fraud risk ${(
          (analysis.skeptic?.fraud_risk || 0) * 100
        ).toFixed(0)}%.`
      );
    } catch (err) {
      notify(`Evidence submission failed: ${err.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleInviteConfirmers() {
    if (!activeMilestone) return;
    try {
      const vInvite = await api(
        `/milestones/${activeMilestone.id}/confirmations/invite`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "vendor",
            contact_ref: "Deccan School Book Depot (+91-98201-11001)",
          }),
        }
      );
      const bInvite = await api(
        `/milestones/${activeMilestone.id}/confirmations/invite`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "beneficiary",
            contact_ref: "Principal Kavita Kulkarni (+91-98201-22002)",
          }),
        }
      );
      const created = [
        {
          ...vInvite,
          contact_ref: "Deccan School Book Depot (+91-98201-11001)",
          tranche_amount: activeMilestone.tranche_amount,
        },
        {
          ...bInvite,
          contact_ref: "Principal Kavita Kulkarni (+91-98201-22002)",
          tranche_amount: activeMilestone.tranche_amount,
        },
      ];
      setInvites(created);
      if (onInviteCreated) {
        onInviteCreated(created);
      }
      await loadConfirmations(activeMilestone.id);
      await onRefresh();
      notify(
        "Issued independent confirmation links to Vendor and School Principal. Switch to 'External Verifier' role to sign off."
      );
    } catch (err) {
      notify(`Could not issue confirmation invites: ${err.message}`, "error");
    }
  }

  async function handleEvaluateAndPayout() {
    if (!activeMilestone) return;
    try {
      notify("Evaluating 6-rule compliance check & Gemini Release Agent...");
      const res = await api(`/milestones/${activeMilestone.id}/decision`, {
        method: "POST",
      });
      setDecisionResult(res);
      if (res.rules_passed && res.decision === "approve") {
        await api(`/payouts/${activeMilestone.id}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actor: "Vidya Grassroots Trust (NGO)",
            human_approved: false,
          }),
        });
        await onRefresh();
        notify(
          `Milestone #${activeMilestone.id} approved! PayPal Payout of ${formatCurrency(
            activeMilestone.tranche_amount
          )} disbursed.`
        );
      } else {
        await onRefresh();
        notify(
          `Release held (${String(res.decision).toUpperCase()}): ${
            res.explanation
          }`,
          "error"
        );
      }
    } catch (err) {
      notify(`Release evaluation error: ${err.message}`, "error");
    }
  }

  if (!activeMilestone) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <p className="text-slate-700 font-semibold">
          No assigned grant milestones found.
        </p>
        <p className="text-sm text-slate-500 mt-1">
          Click <strong>Load Sample Portfolio</strong> in the top bar or create a grant in the Donor Portal first.
        </p>
      </div>
    );
  }

  const matchedCount = confirmations.filter((c) => c.matched).length;

  return (
    <div className="space-y-6">
      {/* Top milestone selector bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-teal-700">
            Active Field Deliverable
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={activeMilestone.id}
              onChange={(e) => {
                setSelectedMilestoneId(Number(e.target.value));
                setChallenge(null);
                setAnalysisResult(null);
                setDecisionResult(null);
              }}
              className="text-base font-bold text-slate-900 border border-slate-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              {allMilestones.map((m) => (
                <option key={m.id} value={m.id}>
                  Grant #{m.project_id} • Milestone {m.order_no}: {m.title} (
                  {formatCurrency(m.tranche_amount)})
                </option>
              ))}
            </select>
            <span
              className={`px-2.5 py-1 rounded-md text-xs font-semibold ${statusBadgeClass(
                activeMilestone.status
              )}`}
            >
              {activeMilestone.status}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {activeMilestone.description || activeMilestone.projectIntent}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleIssueChallenge}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-slate-950 transition shadow-sm"
          >
            <KeyRound className="w-4 h-4" />
            {challenge
              ? `Active Code: ${challenge.code}`
              : "1. Generate Live Challenge Code"}
          </button>

          <button
            type="button"
            onClick={handleInviteConfirmers}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition"
          >
            <UserPlus className="w-4 h-4 text-teal-700" />
            3. Invite Third-Party Confirmers
          </button>

          <button
            type="button"
            onClick={handleEvaluateAndPayout}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white transition shadow-sm"
          >
            <Banknote className="w-4 h-4" />
            4. Verify Compliance &amp; Release Payout
          </button>
        </div>
      </div>

      {/* Main 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 cols: Evidence Capture & Upload */}
        <form
          onSubmit={handleSubmitAndAnalyze}
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Field Evidence &amp; Receipt Submission
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Include the 6-digit challenge code in your photo alongside the vendor invoice or field delivery.
              </p>
            </div>
            {challenge && (
              <div className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-300 text-right">
                <span className="block text-[10px] font-bold uppercase text-amber-800">
                  Write on Placard
                </span>
                <span className="font-mono text-lg font-extrabold text-slate-900 tracking-widest">
                  {challenge.code}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-lg p-1 bg-slate-100">
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  setCaptureMode("upload");
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  captureMode === "upload"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600"
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                Upload Receipt / Photo
              </button>
              <button
                type="button"
                onClick={() => {
                  setCaptureMode("camera");
                  startCamera();
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  captureMode === "camera"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600"
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                Live WebRTC Camera
              </button>
            </div>

            <button
              type="button"
              onClick={handleAttachSampleReceipt}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100 transition"
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              Attach Sample Field Receipt (${activeMilestone.tranche_amount})
            </button>
          </div>

          {captureMode === "camera" ? (
            <div className="space-y-3 bg-slate-950 rounded-xl p-4 text-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full max-h-64 object-cover rounded-lg bg-slate-900 mx-auto"
              />
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  onClick={captureCameraFrame}
                  disabled={!cameraActive}
                  className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold disabled:opacity-50"
                >
                  Capture Photo Frame
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="px-3 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs font-semibold"
                >
                  Stop Camera
                </button>
              </div>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 hover:border-teal-600 rounded-xl p-6 cursor-pointer bg-slate-50/50 transition">
              <Upload className="w-7 h-7 text-slate-400 mb-2" />
              <span className="text-sm font-semibold text-slate-700">
                Select field photos, invoices, or attendance sheets
              </span>
              <span className="text-xs text-slate-500 mt-0.5">
                PNG, JPG, WebP, or PDF • Checked via SHA-256 &amp; 64-bit perceptual dHash
              </span>
              <input
                type="file"
                accept="image/*,application/pdf"
                multiple
                onChange={(e) =>
                  setSelectedFiles(Array.from(e.target.files || []))
                }
                className="hidden"
              />
            </label>
          )}

          {selectedFiles.length > 0 && (
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-3 flex items-center justify-between text-xs text-emerald-900">
              <div className="font-medium">
                Ready to submit:{" "}
                <strong>{selectedFiles.map((f) => f.name).join(", ")}</strong>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFiles([])}
                className="text-emerald-700 underline font-semibold"
              >
                Clear
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Field Officer Delivery Notes
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                GPS Geotag
              </label>
              <button
                type="button"
                onClick={handleDetectGps}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <MapPin className="w-3.5 h-3.5 text-teal-700" />
                {gps.lat}, {gps.lon}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm shadow-sm disabled:opacity-50 transition"
          >
            <Sparkles className="w-4 h-4" />
            {submitting
              ? "Uploading & Running Gemini Multimodal Inspection..."
              : "2. Submit Evidence & Run Gemini Anti-Fraud Verification"}
          </button>
        </form>

        {/* Right 5 cols: Verification Results, Confirmations & Release Status */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-teal-700" />
                Gemini Verifier &amp; Skeptic Assessment
              </h3>
              {analysisResult && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-teal-50 text-teal-800">
                  {analysisResult.verifier?.source || "gemini"}
                </span>
              )}
            </div>

            {!analysisResult ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                Submit field evidence on the left to run multimodal challenge-code OCR, invoice total matching, and duplicate tamper analysis.
              </p>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-slate-500 block">
                      Verifier Confidence
                    </span>
                    <span className="text-lg font-extrabold text-emerald-700">
                      {(
                        (analysisResult.verifier?.confidence || 0) * 100
                      ).toFixed(0)}
                      %
                    </span>
                    <span className="block text-[11px] text-slate-600 mt-0.5">
                      Code Visible:{" "}
                      <strong>
                        {analysisResult.verifier?.challenge_code_visible
                          ? "Yes"
                          : "No"}
                      </strong>{" "}
                      | Amount:{" "}
                      <strong>
                        {formatCurrency(
                          analysisResult.verifier?.extracted_amount
                        )}
                      </strong>
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-slate-500 block">
                      Skeptic Fraud Risk
                    </span>
                    <span
                      className={`text-lg font-extrabold ${
                        (analysisResult.skeptic?.fraud_risk || 0) <= 0.35
                          ? "text-emerald-700"
                          : "text-rose-700"
                      }`}
                    >
                      {((analysisResult.skeptic?.fraud_risk || 0) * 100).toFixed(
                        0
                      )}
                      %
                    </span>
                    <span className="block text-[11px] text-slate-600 mt-0.5">
                      Recommendation:{" "}
                      <strong className="uppercase">
                        {analysisResult.skeptic?.recommendation}
                      </strong>
                    </span>
                  </div>
                </div>

                {analysisResult.skeptic?.concerns?.length > 0 && (
                  <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-900">
                    <span className="font-bold block mb-1">
                      Triggered Risk Concerns:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {analysisResult.skeptic.concerns.map((c, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-mono text-[11px]"
                        >
                          {c.code}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  {analysisResult.verifier?.explanation}
                </p>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Independent Third-Party Sign-Offs
              </h3>
              <span
                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                  matchedCount >= 1
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-800"
                }`}
              >
                {matchedCount} Verified Sign-Off(s)
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Payouts require independent confirmation from the supplying Vendor or Beneficiary representative.
            </p>
            {invites.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {invites.map((inv) => (
                  <div
                    key={inv.token}
                    className="flex items-center justify-between text-xs bg-slate-50 px-3 py-2 rounded-lg border border-slate-200"
                  >
                    <span className="font-semibold capitalize text-slate-800">
                      {inv.kind}: {inv.contact_ref}
                    </span>
                    <code className="text-[11px] bg-white px-2 py-0.5 rounded border border-slate-200 text-teal-800">
                      {inv.token.slice(0, 12)}…
                    </code>
                  </div>
                ))}
              </div>
            )}
          </div>

          {decisionResult && (
            <div
              className={`border rounded-xl p-5 space-y-2 ${
                decisionResult.decision === "approve"
                  ? "bg-emerald-50/70 border-emerald-200 text-emerald-950"
                  : "bg-amber-50/70 border-amber-200 text-amber-950"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider">
                  Release Gate Decision
                </span>
                <span className="px-2.5 py-0.5 rounded-md text-xs font-bold uppercase bg-white/80">
                  {decisionResult.decision}
                </span>
              </div>
              <p className="text-xs leading-relaxed">
                {decisionResult.explanation}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
