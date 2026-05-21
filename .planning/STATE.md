# AyuLink — GSD Project State

## Current Phase
**Phase 7 — Demo Polish + Documentation**

## Status
6 of 7 phases complete. In final polish sprint before hackathon demo.

## Active Work
- Architecture diagram needed for documentation deliverable
- Agent UI model name fix (shows 70B, runs 8B)
- End-to-end demo rehearsal

## Key Context
- Backend runs: `cd backend && python3 main.py --mock`
- Frontend runs: `cd frontend && npm run dev`
- ESP32-CAM at: `http://10.121.171.20:81/stream` (DHCP — may change on reboot)
- Groq model: `llama-3.1-8b-instant` (set in `backend/.env`)
- AI agent chat working, triage working
- Camera proxy at `/api/cam-proxy` avoids CORS

## Completed Phases
- Phase 1: Backend + IoT Ingestion ✅
- Phase 2: AI Triage Agent ✅
- Phase 3: Next.js Dashboard ✅
- Phase 4: Hardware Integration ✅
- Phase 5: ESP32-CAM Live Feed ✅
- Phase 6: SQLite Persistence ✅

## Last Updated
2026-04-11 — Post ESP32-CAM firmware rewrite and agent model fallback fix
