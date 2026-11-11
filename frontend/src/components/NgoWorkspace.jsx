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
  Compass,
  CheckCircle,
} from "lucide-react";
import { api, formatCurrency, statusBadgeClass } from "../api.js";

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
    "Field installation verified on-site with local representative."
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
        `Camera unavailable (${err.message}). Please upload photo files directly.`,
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
        notify("Captured live camera photo frame.");
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
        `Generated single-use code ${ch.code} for Milestone #${activeMilestone.id}.`
      );
      await onRefresh();
      return ch;
    } catch (err) {
      notify(`Could not generate code: ${err.message}`, "error");
      return null;
    }
  }

  function handleDetectGps() {
    if (!navigator.geolocation) {
      notify("Geolocation unavailable; maintaining field coordinates.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: Number(pos.coords.latitude.toFixed(5)),
          lon: Number(pos.coords.longitude.toFixed(5)),
        });
        notify("GPS updated from device sensor.");
      },
      () => {
        notify("Using registered field site GPS.");
      }
    );
  }

  async function handleSubmitAndAnalyze(e) {
    e.preventDefault();
    if (!activeMilestone) return;
    if (selectedFiles.length === 0) {
      notify("Please capture or upload an evidence photo first.", "error");
      return;
    }
    setSubmitting(true);
    try {
      let activeChallenge = challenge;
      if (!activeChallenge) {
        activeChallenge = await handleIssueChallenge();
      }
      if (!activeChallenge?.challenge_id) {
        throw new Error("Missing active challenge code.");
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
          device_id: "ngo-field-tablet-01",
          notes,
        })
      );
      selectedFiles.forEach((f) => fd.append("files", f, f.name));

      notify("Analyzing evidence with SHA-256 and perceptual difference hashes...");
      const sub = await api(`/milestones/${activeMilestone.id}/submissions`, {
        method: "POST",
        body: fd,
      });

      const analysis = await api(`/submissions/${sub.submission_id}/analyze`, {
        method: "POST",
      });
      setAnalysisResult(analysis);
      setChallenge(null);
      await onRefresh();
      notify("Evidence processed and cross-verified.");
    } catch (err) {
      notify(`Submission failed: ${err.message}`, "error");
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
            contact_ref: "Primary Field Supplier (+91-98201-11001)",
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
            contact_ref: "Local Committee Representative (+91-98201-22002)",
          }),
        }
      );
      const created = [
        {
          ...vInvite,
          contact_ref: "Primary Field Supplier",
          tranche_amount: activeMilestone.tranche_amount,
        },
        {
          ...bInvite,
          contact_ref: "Local Committee Representative",
          tranche_amount: activeMilestone.tranche_amount,
        },
      ];
      setInvites(created);
      if (onInviteCreated) {
        onInviteCreated(created);
      }
      await loadConfirmations(activeMilestone.id);
      await onRefresh();
      notify("Issued independent verification tokens to Supplier and Beneficiary.");
    } catch (err) {
      notify(`Invite generation error: ${err.message}`, "error");
    }
  }

  async function handleEvaluateAndPayout() {
    if (!activeMilestone) return;
    try {
      notify("Evaluating release rules...");
      const res = await api(`/milestones/${activeMilestone.id}/decision`, {
        method: "POST",
      });
      setDecisionResult(res);
      if (res.rules_passed && res.decision === "approve") {
        await api(`/payouts/${activeMilestone.id}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actor: "NGO Field Partner",
            human_approved: false,
          }),
        });
        await onRefresh();
        notify(
          `Milestone #${activeMilestone.id} released: ${formatCurrency(
            activeMilestone.tranche_amount
          )} transferred!`
        );
      } else {
        await onRefresh();
        notify(`Release status: ${res.explanation}`);
      }
    } catch (err) {
      notify(`Evaluation notice: ${err.message}`, "error");
    }
  }

  if (!activeMilestone) {
    return (
      <div className="bg-white border border-warmgray-200 rounded-2xl p-10 text-center">
        <p className="text-warmgray-800 font-semibold">
          No deliverables assigned yet.
        </p>
      </div>
    );
  }

  const matchedCount = confirmations.filter((c) => c.matched).length;

  return (
    <div className="space-y-6">
      {/* Top Banner with Forest / Earth Tones */}
      <div className="bg-gradient-to-r from-forest-900 via-forest-800 to-warmgray-900 text-white rounded-2xl p-6 shadow-sm border border-forest-700/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-forest-300 text-xs font-bold uppercase tracking-wider">
            <Compass className="w-4 h-4 text-forest-400" />
            <span>Field Operations &amp; Verification</span>
          </div>
          <h1 className="text-xl font-bold font-serif">
            Deliverable Proof &amp; Payout Release
          </h1>
          <p className="text-xs text-warmgray-300">
            Generate one-time placard codes, upload delivery proof, and request milestone tranches.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleIssueChallenge}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-warmgray-950 transition cursor-pointer shadow-sm"
          >
            <KeyRound className="w-3.5 h-3.5" />
            {challenge ? `Placard: ${challenge.code}` : "Generate Live Placard Code"}
          </button>
          <button
            type="button"
            onClick={handleInviteConfirmers}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-forest-950/70 hover:bg-forest-950 text-forest-200 border border-forest-600 transition cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Invite Confirmers
          </button>
          <button
            type="button"
            onClick={handleEvaluateAndPayout}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-terracotta-600 hover:bg-terracotta-500 text-white transition cursor-pointer shadow-sm"
          >
            <Banknote className="w-3.5 h-3.5" />
            Request Tranche Release
          </button>
        </div>
      </div>

      {/* Milestone selector */}
      <div className="bg-white border border-warmgray-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-forest-700">
            Current Deliverable
          </span>
          <div className="flex items-center gap-3">
            <select
              value={activeMilestone.id}
              onChange={(e) => {
                setSelectedMilestoneId(Number(e.target.value));
                setChallenge(null);
                setAnalysisResult(null);
                setDecisionResult(null);
              }}
              className="text-base font-bold text-warmgray-900 border border-warmgray-300 rounded-xl px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-forest-600"
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
        </div>

        {challenge && (
          <div className="px-4 py-2 rounded-xl bg-amber-50 border border-amber-300 text-right">
            <span className="block text-[10px] font-bold uppercase text-amber-900">
              Hold in Photo Frame
            </span>
            <span className="font-mono text-xl font-extrabold text-warmgray-900 tracking-widest">
              {challenge.code}
            </span>
          </div>
        )}
      </div>

      {/* Main 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 cols: Evidence Capture & Upload */}
        <form
          onSubmit={handleSubmitAndAnalyze}
          className="lg:col-span-7 bg-white border border-warmgray-200 rounded-2xl p-6 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-warmgray-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-warmgray-900 font-serif">
                Field Evidence Submission
              </h3>
              <p className="text-xs text-warmgray-500 mt-0.5">
                Capture the one-time code alongside delivery goods or vendor tax invoice.
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                stopCamera();
                setCaptureMode("upload");
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                captureMode === "upload"
                  ? "bg-warmgray-900 text-white"
                  : "bg-warmgray-100 text-warmgray-700"
              }`}
            >
              <Upload className="w-3.5 h-3.5 inline mr-1" />
              File Upload
            </button>
            <button
              type="button"
              onClick={() => {
                setCaptureMode("camera");
                startCamera();
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                captureMode === "camera"
                  ? "bg-warmgray-900 text-white"
                  : "bg-warmgray-100 text-warmgray-700"
              }`}
            >
              <Camera className="w-3.5 h-3.5 inline mr-1" />
              Live In-App Camera
            </button>
          </div>

          {captureMode === "camera" ? (
            <div className="space-y-3 bg-warmgray-950 rounded-2xl p-4 text-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full max-h-64 object-cover rounded-xl bg-warmgray-900 mx-auto"
              />
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  onClick={captureCameraFrame}
                  disabled={!cameraActive}
                  className="px-4 py-2 rounded-xl bg-forest-600 hover:bg-forest-500 text-white text-xs font-bold cursor-pointer"
                >
                  Capture Frame
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="px-3 py-2 rounded-xl bg-warmgray-800 text-warmgray-200 text-xs font-semibold cursor-pointer"
                >
                  Stop Camera
                </button>
              </div>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-warmgray-300 hover:border-forest-600 rounded-2xl p-6 cursor-pointer bg-warmgray-50/50 transition">
              <Upload className="w-7 h-7 text-warmgray-400 mb-2" />
              <span className="text-sm font-semibold text-warmgray-800">
                Select field delivery photos or invoices
              </span>
              <span className="text-xs text-warmgray-500 mt-0.5">
                PNG, JPG, or PDF • Cross-referenced via perceptual hashing
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
            <div className="bg-forest-50 border border-forest-200 rounded-xl p-3 flex items-center justify-between text-xs text-forest-950">
              <span className="truncate">
                Ready to submit: <strong>{selectedFiles.map((f) => f.name).join(", ")}</strong>
              </span>
              <button
                type="button"
                onClick={() => setSelectedFiles([])}
                className="text-forest-800 underline font-bold cursor-pointer shrink-0 ml-2"
              >
                Clear
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-warmgray-700 mb-1">
                Field Officer Delivery Notes
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                required
                className="w-full rounded-xl border border-warmgray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-forest-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-warmgray-700 mb-1">
                Field Site Geotag
              </label>
              <button
                type="button"
                onClick={handleDetectGps}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-warmgray-300 px-3 py-2 text-xs font-semibold text-warmgray-700 hover:bg-warmgray-50 cursor-pointer"
              >
                <MapPin className="w-3.5 h-3.5 text-forest-700" />
                {gps.lat}, {gps.lon}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-forest-700 hover:bg-forest-600 text-white font-bold text-sm shadow-sm disabled:opacity-50 transition cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            {submitting ? "Analyzing Field Proof..." : "Submit Evidence & Run Verification"}
          </button>
        </form>

        {/* Right 5 cols: Verification Results & Confirmations */}
        <div className="lg:col-span-5 space-y-5">
          {/* AI Inspection Card */}
          <div className="bg-white border border-warmgray-200 rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-warmgray-900 font-serif flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-forest-700" />
              Automated Forensic Verification
            </h3>

            {!analysisResult ? (
              <p className="text-xs text-warmgray-500 py-6 text-center">
                Submit evidence to trigger OCR challenge-code inspection and duplicate perceptual difference analysis.
              </p>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-warmgray-50 border border-warmgray-200">
                    <span className="text-warmgray-500 block">Confidence</span>
                    <span className="text-lg font-bold text-forest-700">
                      {((analysisResult.verifier?.confidence || 0) * 100).toFixed(0)}%
                    </span>
                    <span className="block text-[11px] text-warmgray-600 mt-0.5">
                      Code: {analysisResult.verifier?.challenge_code_visible ? "Visible" : "Missing"}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-warmgray-50 border border-warmgray-200">
                    <span className="text-warmgray-500 block">Fraud Risk</span>
                    <span className="text-lg font-bold text-warmgray-900">
                      {((analysisResult.skeptic?.fraud_risk || 0) * 100).toFixed(0)}%
                    </span>
                    <span className="block text-[11px] text-warmgray-600 mt-0.5 uppercase">
                      {analysisResult.skeptic?.recommendation || "PASS"}
                    </span>
                  </div>
                </div>
                <p className="text-warmgray-700 bg-warmgray-50 p-3 rounded-xl border border-warmgray-200 leading-relaxed">
                  {analysisResult.verifier?.explanation}
                </p>
              </div>
            )}
          </div>

          {/* Third-Party Confirmation Status */}
          <div className="bg-white border border-warmgray-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-warmgray-900 font-serif">
                Independent Third-Party Sign-Offs
              </h3>
              <span
                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                  matchedCount >= 1
                    ? "bg-forest-100 text-forest-800"
                    : "bg-amber-100 text-amber-900"
                }`}
              >
                {matchedCount} Confirmed
              </span>
            </div>
            <p className="text-xs text-warmgray-500">
              Tranches require independent verification from the supplying vendor or beneficiary.
            </p>
            {invites.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {invites.map((inv) => (
                  <div
                    key={inv.token}
                    className="flex items-center justify-between text-xs bg-warmgray-50 px-3 py-2 rounded-xl border border-warmgray-200"
                  >
                    <span className="font-semibold text-warmgray-800">
                      {inv.contact_ref}
                    </span>
                    <code className="text-[11px] font-mono bg-white px-2 py-0.5 rounded border border-warmgray-200 text-terracotta-800">
                      {inv.token.slice(0, 10)}…
                    </code>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
