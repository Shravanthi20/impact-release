import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.VITE_API_PROXY || "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/users": API_TARGET,
      "/projects": API_TARGET,
      "/milestones": API_TARGET,
      "/submissions": API_TARGET,
      "/confirm": API_TARGET,
      "/review": API_TARGET,
      "/payouts": API_TARGET,
      "/webhooks": API_TARGET,
      "/ledger": API_TARGET,
      "/audit": API_TARGET,
      "/demo": API_TARGET,
      "/eval": API_TARGET,
      "/graph": API_TARGET,
      "/health": API_TARGET,
    },
  },
});
