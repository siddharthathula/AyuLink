# AyuLink ElderCare — Milestone v1.0: Hackathon MVP

## Milestone Goal
Deliver a complete, demo-ready Remote Patient Monitoring IoT Agent for hackathon submission. All hardware integrations, AI triage, real-time dashboard, and multilingual alerts must be functional and demonstrable.

---

## Phase 1 — Backend Core: IoT Ingestion + Threshold Engine ✅
**Status:** COMPLETE
**Goal:** Real-time vital ingestion pipeline with threshold-based alert generation.

### Plans
- [x] 1.1 FastAPI app with WebSocket server for dashboards (`/ws/dashboard`)
- [x] 1.2 WebSocket client for Gateway ESP32 (`connect_to_gateway`)
- [x] 1.3 `ThresholdEngine` — HR, SpO2, Temp, Flame, AQI thresholds with cooldowns
- [x] 1.4 `MockDataStream` — cardiac events, SOS, falls, device offline simulation
- [x] 1.5 Composite risk score (0–100) per patient

**UAT:** Backend starts with `--mock` flag, vitals broadcast to WebSocket clients every 3s ✅

---

## Phase 2 — AI Triage Agent ✅
**Status:** COMPLETE
**Goal:** Groq-powered LLM agent that auto-triages alerts with headline/detail/action output.

### Plans
- [x] 2.1 `AyuAgent` class with Groq AsyncGroq client
- [x] 2.2 Triage prompt engineering (vitals + env + meds correlation)
- [x] 2.3 Mental health distress detection + empathetic response
- [x] 2.4 Multilingual support (EN/HI/TE)
- [x] 2.5 Runtime API key hot-swap (`POST /api/agent/apikey`)
- [x] 2.6 Cooldown system to prevent token spam
- [x] 2.7 Model fallback: `llama-3.1-8b-instant` (rate-limit resilient)

**UAT:** Cardiac event triggers AI insight in <1s, chat responds in EN/HI/TE ✅

---

## Phase 3 — Next.js Dashboard + Real-Time UI ✅
**Status:** COMPLETE
**Goal:** Production-grade frontend with live vitals, alerts, and AI insights.

### Plans
- [x] 3.1 Next.js 15 App Router setup with dark mode design system
- [x] 3.2 Live vitals dashboard (`/vitals`) with HR/SpO2/Temp/risk cards
- [x] 3.3 AI Agent page (`/agent`) with chat, triage insights, demo buttons
- [x] 3.4 Notifications page (`/notifications`) — multilingual push alerts
- [x] 3.5 Family portal (`/family`) — caregiver view with vitals + camera
- [x] 3.6 Dispenser page (`/dispensers`) — pill slots + hub sensor data
- [x] 3.7 Patient registry (`/patients`) — SQLite-backed CRUD

**UAT:** All pages load, WebSocket reconnects on disconnect, demo buttons fire events ✅

---

## Phase 4 — Hardware Integration ✅
**Status:** COMPLETE
**Goal:** Physical ESP32 devices communicate with backend.

### Plans
- [x] 4.1 ESP32-S3 Smart Hub firmware (servo pill dispenser, SSD1306 OLED, MQ-135, Flame)
- [x] 4.2 ESP32 Wearable firmware (MAX30100, MLX90614, MPU6050, GPS, LoRa)
- [x] 4.3 Gateway ESP32 firmware (LoRa receiver → WebSocket to backend)
- [x] 4.4 OLED display shows live patient vitals from backend

**UAT:** Hub connects to `/ws/hub`, OLED updates with patient HR/SpO2/Temp/Status ✅

---

## Phase 5 — ESP32-CAM Live Feed ✅
**Status:** COMPLETE
**Goal:** MJPEG video stream from ESP32-CAM visible in the dashboard.

### Plans
- [x] 5.1 ESP32-CAM AI-Thinker firmware with `esp_http_server` MJPEG stream
- [x] 5.2 Brown-out protection + PSRAM detection + QVGA resolution (lag-free)
- [x] 5.3 Next.js `/api/cam-proxy` route — server-side MJPEG pipe (avoids CORS)
- [x] 5.4 Camera window in Family + Dispenser portals (480×300px)
- [x] 5.5 `next.config.ts` rewrite exclusion for cam-proxy

**UAT:** Camera streams at QVGA 320×240 with no lag ✅

---

## Phase 6 — SQLite Persistence ✅
**Status:** COMPLETE
**Goal:** Persistent local storage for patients, vitals history, alerts, notifications.

### Plans
- [x] 6.1 SQLite schema: patients, vitals, alerts, notifications, reports
- [x] 6.2 All patient CRUD APIs wired to SQLite (`GET/POST /api/patients`)
- [x] 6.3 Vitals history persisted per patient
- [x] 6.4 Alert log persisted and queryable

**UAT:** Patient records survive backend restart, vitals history available via API ✅

---

## Phase 7 — Demo Polish + Documentation ⬜
**Status:** IN PROGRESS
**Goal:** Hackathon-ready demo with architecture docs and polished UI.

### Plans
- [ ] 7.1 Add system architecture diagram to documentation
- [ ] 7.2 Fix AI model display name in Agent UI (shows 70B, runs 8B)
- [ ] 7.3 Verify demo event buttons work end-to-end (CARDIAC → AI insight → OLED)
- [ ] 7.4 Update AYULINK_FULL_CODEBASE.md with latest changes
- [ ] 7.5 Final end-to-end system test

**UAT:** 5-minute demo runs cleanly with hardware visible to judges

---

## Backlog (999.x)

- 999.1 Supabase cloud sync (removed — SQLite is faster for demo)
- 999.2 Mobile app (React Native) for family notifications
- 999.3 LoRa mesh multi-node routing
