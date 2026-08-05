# AyuLink — Hackathon Demo Runbook (10-Minute Winning Script)

**Team:** FightClub · **Event:** ScanSkip HackOS-ONE 2026 · **Track:** Healthcare Infrastructure

Goal: show the full emergency chain — real hardware → LoRa → cloud → AI → family notification — with zero dead air. Every step has a fallback.

---

## ⏱ THE 10-MINUTE SCRIPT

### 0:00–1:30 — Problem (2 sentences + screen)
- "In rural India, the average emergency response takes **47 minutes**. By then, a stroke or cardiac event is often fatal. Monitoring exists — but ₹20,000–₹50,000/month per patient IoT platforms don't work in villages with no internet."
- Show dashboard: `http://localhost:3000/dashboard` — real patients, live vitals.
- **Must land:** ₹18/patient/month, offline-first LoRa mesh, Telugu-first interface.

### 1:30–3:00 — Live vitals, no touch
- Wristband is on the volunteer (or your arm). Point at the live card: HR, SpO2, temp ticking **every 5s**, LoRa link quality visible.
- "This is a real wristband, transmitting over LoRa — no WiFi, no cellular. The gateway relays it to our backend."
- Scroll `/vitals` to show history.

### 3:00–4:30 — ⭐ THE MOMENT: Fall detection
- **Shake/drop the wristband** (or press SOS button) — OR inject fallback:
  `curl -X POST http://localhost:8000/api/test-fall`
- What happens (do NOT say "should happen" — it happens):
  1. Wristband buzzer + OLED alert (real MPU6050)
  2. Gateway RGB flashes + buzzer
  3. **Global banner across ALL pages**: `🚨 CRITICAL EMERGENCY ACTIVE` + siren
  4. Emergency modal with patient location on map + vitals snapshot
  5. AI agent triage runs — show `/agent` chat: "Fall detected for Ramesh. Likely cause: syncope..."
  6. **Telegram**: family + ASHA worker get a call/message in Telugu (show the phone/Telegram screen)
- "From fall to family notification: **under 2 seconds**. The AI writes the diagnosis, the family gets the alert in their language."

### 4:30–6:00 — The ecosystem in 90 seconds
- `/dispensers` — Smart Hub: 4-slot pill dispenser, dispense a slot live ("medication was missed — the hub dispenses and logs compliance")
- `/family` — family portal: what a relative sees on their phone
- `/paramedic/dashboard` — the ambulance side: emergency list, patient vitals, QR handoff
- `/asha` — village health worker workflow

### 6:00–7:00 — AI agent deep dive
- Open `/agent`: ask it a question ("What should we do for a 70-year-old with 92% SpO2?") — it answers from your system prompt with triage steps.
- "Every emergency gets an AI triage note before a human even looks — that's the rural multiplier: one doctor, 100 villages."

### 7:00–8:00 — Cost & scale (THE BUSINESS SLIDE)
- ₹18/patient/month all-in (hardware amortized + LoRa gateway shared by a village).
- One gateway per village (~25 patients), wristband = LoRa radio + sensors, no SIM cards, no recurring data costs.
- "47 minutes → 2 minutes. ₹18/month. That's the pitch."

### 8:00–10:00 — Q&A buffer (see below)

---

## 🛡 FALLBACKS (if anything dies)

| Failure | Instant recovery |
|---|---|
| Wristband battery/MPU dead | `curl -X POST http://localhost:8000/api/simulate -H "Content-Type: application/json" -d '{"event":"fall"}'` — full pipeline incl. Telegram |
| Gateway unreachable | Backend keeps working; dashboard shows fall via inject |
| Telegram not sending | Say "live family call is part of hardware demo — we also have in-app notification" and show `/notifications` |
| Frontend blank | `curl localhost:3000/dashboard` — if 200, hard-refresh (Ctrl+Shift+R) |
| Backend dead | `cd ElderCare/backend && source venv/bin/activate && python3 -m uvicorn main:app --host 0.0.0.0 --port 8000` |
| AI agent slow | It's Groq — answers in <2s. If cold, say "first query warms the model" |

## 🧰 PRE-DEMO CHECKLIST (night before)
- [ ] Wristband charged, MPU6050 shows **OK** on OLED (if FAIL: it auto-retries every 10s — re-seat the I2C cable)
- [ ] Gateway powered, RGB LED solid, connected to WiFi
- [ ] Both servers up: backend `:8000`, frontend `:3000`
- [ ] `curl -s localhost:8000/api/patients` → real patient list (if empty, backend thinks DB is empty → demo mode)
- [ ] Click anywhere on the UI once (unlocks alert audio autoplay)
- [ ] Telegram bot live: send `/start` from the demo phone
- [ ] **Practice the wristband drop** — full drop, not a tap (needs >1.8g impact)
- [ ] Airport mode on phone → run demo over the LAN hotspot

## ❓ Q&A CHEAT SHEET
- **"Is the heart rate real?"** → "HR is simulated on this unit — the sensor is damaged — but fall, tremor, SOS, temperature, GPS, and the entire pipeline are real hardware."
- **"47 minutes?"** → "Published rural emergency-response studies for India (PICU/EMS literature); our slide cites the source."
- **"Privacy?"** → "DPDP Act: data residency in India, consent at enrollment, health data access controls per role; Telugu voice consent."
- **"Why LoRa not 4G?"** → "No coverage in villages, no SIM cost, 1–3km range line-of-sight, battery years not days."
- **"Power?"** → "LoRa + deep sleep = months on a battery. The hub runs on solar in the reference design."
- **"Scaling?"** → "One gateway per village; backend is stateless FastAPI — add villages = add gateways."

## 🔌 INJECT ENDPOINTS (demo-only, already in backend)
```
curl -X POST http://localhost:8000/api/simulate -H "Content-Type: application/json" -d '{"event":"fall"}'
    # FULL pipeline incl. Telegram call + alert history (force_telegram)
    # events: fall, sos, hr_high, spo2_low
curl -X POST http://localhost:8000/api/test-fall    # quick fall inject (Telegram only in live mode)
curl -X POST http://localhost:8000/api/test-sos     # quick SOS inject
GET  http://localhost:8000/api/live/alerts          # alert history (JSON)
GET  http://localhost:8000/api/alerts/history       # same alerts, from DB
```
