# AyuLink ElderCare Remote Patient Monitoring System

## What This Is
AyuLink is an end-to-end IoT and AI-driven medical monitoring platform connecting physical ESP32 medical wearables and smart pill dispensers to a centralized dashboard. An AI agent (powered by Groq) triages incoming patient telemetry, predicts critical health events, handles mental health detection, and pushes multilingual alerts directly to users.

## Core Value
Provides automated, real-time, zero-boundary continuous monitoring, localized multi-lingual AI alerts, and physical hardware smart interactions (pill dispensers/alarms) for remote eldercare in inaccessible areas like rural Telangana.

## Requirements

### Validated
- ✓ Local SQLite integration for persistent storage
- ✓ Real-time WebSocket connection for bi-directional telemetry
- ✓ Multilingual distress chatbot with Groq inference (EN, HI, TE)
- ✓ NextJS App Router frontend with real-time UI mapping
- ✓ Telemetry ingest from ESP32 Wearable (HR, SpO2, Fall Detection)
- ✓ ESP32 Smart Hub integration (MQ135 Air Quality, Flame Sensor, Pill Dispenser)
- ✓ Proxy-based ESP32-CAM MJPEG view with QVGA integration
- ✓ Dynamic API Key swapping in Dashboard
- ✓ AI model rate limit resiliency (`llama-3.1-8b-instant` default)

### Active
- [ ] Connect physical ESP32 hardware for final hackathon demo
- [ ] Test end-to-end hardware-to-UI AI triage event flow

### Out of Scope
- [Supabase Integration] — Removed in favor of strict local SQLite storage for privacy and simplified standalone deployment.
- [Cloud Video Streaming] — Streaming happens directly over local TCP IP proxy to minimize lag and third-party dependencies.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Next.js API Proxy for Camera | Standard browser `<img src="http://IP">` tags block cross-origin requests. A Node.js readablestream proxy resolves this seamlessly. | Live |
| Local SQLite DB | Ensures data privacy and removes dependency on external Supabase servers during unpredictable hackathon networking. | Live |
| Fallback Llama 3.1 8B Model | The 70B model exhausts free-tier daily quotas quickly via polling, blocking crucial demo flows. | Live |

## Evolution
This document evolves at phase transitions and milestone boundaries.

---
*Last updated: 2026-04-11 after GSD initialization*
