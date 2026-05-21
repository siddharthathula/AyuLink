"""
AyuLink IoT Monitoring Agent — Main Application

FastAPI server with:
  - WebSocket server for Dashboard clients and ESP32-S3 Hub
  - WebSocket client for Gateway ESP32 (LoRa receiver)
  - Mock IoT data stream for demo mode
  - REST API for system status and demo controls
  - Static file serving for the dashboard UI
"""
import asyncio
import json
import sys
import time
import argparse
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich import box
import os

from config import BACKEND_HOST, BACKEND_PORT, GATEWAY_WS_URL
import config
from models import VitalReading, HubReading
from threshold_engine import ThresholdEngine
from mock_stream import MockDataStream
from ai_agent import AyuAgent
import database as db
import telegram_bot as tgbot

# ── Globals ──────────────────────────────────────────────

console = Console()
engine = ThresholdEngine()
ai_agent: AyuAgent | None = None
mock_stream: MockDataStream | None = None
dashboard_clients: set[WebSocket] = set()
hub_ws: WebSocket | None = None
gateway_ws: WebSocket | None = None  # Gateway ESP32 connects here as WS client
USE_MOCK = False   # LIVE mode: Gateway ESP32 is the real data source
GATEWAY_CONNECTED = False

# Load persisted cam URL from file (survives restarts)
_CAM_URL_FILE = os.path.join(os.path.dirname(__file__), ".cam_url")
def _load_cam_url() -> str:
    try:
        if os.path.exists(_CAM_URL_FILE):
            return open(_CAM_URL_FILE).read().strip()
    except Exception:
        pass
    return os.getenv("ESP32_CAM_URL", "")

def _save_cam_url(url: str):
    try:
        open(_CAM_URL_FILE, 'w').write(url)
    except Exception:
        pass

esp32_cam_url: str = _load_cam_url()  # Runtime-settable ESP32-CAM stream URL
latest_cam_frame: bytes = b""  # Holds the most recent JPEG frame for Telegram/Frontend

async def _camera_proxy_loop():
    """Continuously fetches frames from the ESP32-CAM.
    Retries indefinitely until the camera comes online."""
    global esp32_cam_url, latest_cam_frame
    import httpx

    while True:
        if not esp32_cam_url:
            await asyncio.sleep(2)
            continue

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                async with client.stream("GET", esp32_cam_url) as response:
                    if response.status_code == 200:
                        console.print(f"  [bold green]📷 ESP32-CAM connected: {esp32_cam_url}[/]")
                        buffer = b""
                        async for chunk in response.aiter_bytes():
                            buffer += chunk
                            start = buffer.find(b"\xff\xd8")
                            end = buffer.find(b"\xff\xd9")
                            if start != -1 and end != -1 and end > start:
                                latest_cam_frame = buffer[start:end+2]
                                buffer = buffer[end+2:]
                    else:
                        await asyncio.sleep(2)
        except Exception as e:
            console.print(f"  [yellow]📷 ESP32-CAM waiting ({esp32_cam_url}): {e.__class__.__name__}[/]")
            await asyncio.sleep(3)

# ── Emergency alert buffer (replay to newly connected dashboards) ────────────
from collections import deque as _deque
_emergency_buffer: _deque = _deque(maxlen=10)  # last 10 emergency alerts


# ── Dashboard Broadcasting ───────────────────────────────

async def broadcast_to_dashboards(event_type: str, data: dict):
    """Send a JSON message to all connected dashboard WebSocket clients."""
    msg = json.dumps({"event": event_type, "data": data})
    disconnected = set()
    for ws in dashboard_clients:
        try:
            await ws.send_text(msg)
        except Exception:
            disconnected.add(ws)
    dashboard_clients.difference_update(disconnected)


async def broadcast_vital(reading: VitalReading):
    """Broadcast a vital reading and any alerts to dashboards."""
    await broadcast_to_dashboards("vital", reading.model_dump())


async def broadcast_hub(reading: HubReading):
    """Broadcast hub data to dashboards."""
    await broadcast_to_dashboards("hub", reading.model_dump())


async def broadcast_alert(alert_data: dict):
    """Broadcast an alert to dashboards, buffer emergencies, and forward to Telegram."""
    # Buffer emergency alerts so reconnecting clients don't miss them
    if alert_data.get("severity") == "emergency":
        _emergency_buffer.append({"ts": time.time(), "data": alert_data})
    await broadcast_to_dashboards("alert", alert_data)

    # ── Forward to Telegram ───────────────────────────────────────────────
    # (fire-and-forget async task; never blocks the main loop)
    asyncio.create_task(tgbot.send_alert(
        alert_type=alert_data.get("alert_type", "unknown"),
        message=alert_data.get("message", ""),
        patient_name=alert_data.get("patient_name", ""),
        value=alert_data.get("value", ""),
    ))


async def broadcast_full_state():
    """Broadcast the full dashboard state."""
    state = engine.get_dashboard_state()
    # Include gateway connection status so dashboard banner updates correctly
    state["gateway_connected"] = GATEWAY_CONNECTED and gateway_ws is not None
    state["use_mock"] = USE_MOCK
    await broadcast_to_dashboards("state", state)


# ── Vital Processing Pipeline ───────────────────────────

# ── Per-patient OLED cooldown: avoid spamming gateway within 60 seconds ──
_last_oled_alert: dict = {}  # patient_id -> timestamp
OLED_COOLDOWN_SEC = 10  # Demo: re-send OLED alert every 10s (was 60s)

# ── Hub alert cooldown: air quality fires every packet, throttle it ──
_last_hub_alert: dict = {}  # alert_type -> timestamp
HUB_ALERT_COOLDOWN_SEC = 300  # only forward hub alerts to LoRa once per 5 min (was 60s — caused spam)


async def handle_vital(reading: VitalReading):
    """Process a vital reading through the threshold engine and broadcast."""
    if reading.fall or reading.sos:
        console.print(f"  [bold red]>>> handle_vital: EMERGENCY fall={reading.fall} sos={reading.sos} pid={reading.patient_id}[/]")
    alerts = engine.process_vital(reading)
    if reading.fall or reading.sos:
        console.print(f"  [bold red]>>> alerts generated: {len(alerts)}[/]")
    await broadcast_vital(reading)

    # Record into AI trend buffer for risk score calculation
    from ai_agent import record_vital as ai_record
    ai_record(reading.patient_id, reading.hr or 0, reading.spo2 or 0, reading.temp or 0.0)


    # Mark patient online in DB when we receive their vitals
    if reading.worn and reading.hr > 0:
        try:
            with db.get_db() as conn:
                conn.execute(
                    "UPDATE patients SET device_status='online', updated_at=? WHERE id=?",
                    (__import__('time').time(), reading.patient_id)
                )
        except Exception:
            pass

    # Forward patient vitals to Smart Hub OLED display
    if hub_ws and reading.worn and reading.hr > 0:
        state = engine.patients.get(reading.patient_id)
        try:
            await hub_ws.send_text(json.dumps({
                "cmd": "vitals",
                "hr": reading.hr,
                "spo2": reading.spo2,
                "temp": reading.temp,
                "name": state.name if state else reading.patient_id,
                "status": state.status if state else "normal",
                "risk": state.risk_score if state else 0,
            }))
        except Exception:
            pass

    for alert in alerts:
        # Attach current vitals snapshot to alert for dashboard display
        alert_dict = alert.model_dump()
        alert_dict["vitals_snapshot"] = {
            "hr": reading.hr, "spo2": reading.spo2,
            "temp": reading.temp, "bp_sys": reading.bp_systolic,
        }
        await broadcast_alert(alert_dict)
        # Terminal alert
        severity_colors = {
            "info": "blue", "warning": "yellow",
            "critical": "red", "emergency": "bold red on white",
        }
        color = severity_colors.get(alert.severity, "white")
        console.print(f"  🚨 [{color}]{alert.severity.upper()}[/] {alert.message}")

        # ── Forward EMERGENCY alerts to Gateway OLED ──────────────────────────────
        # SOS/Fall ALWAYS bypass cooldown — never silenced by timer
        if alert.severity == "emergency" and gateway_ws:
            now = time.time()
            is_immediate = alert.alert_type.value in ("sos", "fall")  # never throttle these
            last = _last_oled_alert.get(reading.patient_id, 0)
            if is_immediate or (now - last >= OLED_COOLDOWN_SEC):
                _last_oled_alert[reading.patient_id] = now
                import unicodedata as _ud
                def _ascii(t): return "".join(c for c in _ud.normalize("NFKD", t).encode("ascii","ignore").decode("ascii") if 0x20 <= ord(c) <= 0x7E).strip()
                try:
                    await gateway_ws.send_text(json.dumps({
                        "cmd":   "emergency",
                        "type":  alert.alert_type.value,
                        "title": _ascii(alert.alert_type.value.upper().replace("_", " "))[:18],
                        "notif": _ascii(alert.message)[:80],
                        "severity": "emergency",
                    }))
                    console.print(f"  [bold red]📡 OLED Emergency: {alert.alert_type.value}[/]")
                except Exception:
                    pass
                break  # send only ONE notification per vitals packet — no spam

        # ── AI Agent Triage (fire on emergency only to save tokens) ──
        if ai_agent and alert.severity == "emergency":
            asyncio.create_task(_run_agent_vital(reading, alert.severity, alert.alert_type.value))


async def handle_hub(reading: HubReading):
    """Process hub data through the threshold engine and broadcast."""
    alerts = engine.process_hub(reading)
    await broadcast_hub(reading)

    for alert in alerts:
        await broadcast_alert(alert.model_dump())
        console.print(f"  🔥 [bold red]{alert.message}[/]")

        # ── AI Agent Triage for environment alerts (fire on emergency only) ──
        if ai_agent and alert.severity == "emergency":
            asyncio.create_task(_run_agent_hub(reading, alert.severity, alert.alert_type.value))

        # ── Notify Gateway OLED + Wristband via LoRa downlink ──
        # Use compact payload — LoRa max safe payload ~100 bytes
        # Throttle hub alerts: air quality fires every packet, cap at once/60s
        if gateway_ws and alert.severity in ("emergency", "critical"):
            alert_key = alert.alert_type.value
            now_hub = time.time()
            last_hub = _last_hub_alert.get(alert_key, 0)
            if now_hub - last_hub >= HUB_ALERT_COOLDOWN_SEC:
                _last_hub_alert[alert_key] = now_hub
                try:
                    import unicodedata as _ud2
                    def _asc2(t): return "".join(c for c in _ud2.normalize("NFKD", t).encode("ascii","ignore").decode("ascii") if 0x20 <= ord(c) <= 0x7E).strip()
                    hub_alert_payload = json.dumps({
                        "cmd": "notification",
                        "title": "FIRE" if reading.flame else "HUB",
                        "notif": _asc2(alert.message)[:60],
                    })
                    await gateway_ws.send_text(hub_alert_payload)
                    console.print(f"  [yellow]📡 Hub alert → Gateway: {alert.message[:40]}[/]")
                except Exception:
                    pass

    # ── Forward hub sensor data to Gateway (wristband OLED shows dispenser status) ──
    # Send AFTER alerts so emergency cmd arrives first on gateway
    if gateway_ws:
        try:
            hub_fwd = json.dumps({
                "type": "hub",
                "hub_temp":     round(reading.env_temp, 1),
                "hub_humidity": round(reading.humidity, 1),
                "hub_air_ppm":  reading.air_ppm,
                "hub_aqi":      reading.air_aqi,
                "hub_flame":    reading.flame,
                "hub_slot1":    reading.pill_slot1,
                "hub_slot2":    reading.pill_slot2,
                "hub_slot3":    reading.pill_slot3,
                "hub_slot4":    getattr(reading, 'pill_slot4', False),
            })
            await gateway_ws.send_text(hub_fwd)
        except Exception:
            pass



async def _run_agent_vital(reading: VitalReading, severity: str, trigger: str):
    """Run AI triage for a vital alert and broadcast result."""
    patient_state = engine.patients.get(reading.patient_id)
    hub = engine.hub_state
    if not patient_state:
        return

    insight = await ai_agent.analyze(
        patient_id=reading.patient_id,
        patient_name=patient_state.name,
        age=patient_state.age,
        conditions=patient_state.conditions,
        hr=reading.hr,
        spo2=reading.spo2,
        temp=reading.temp,
        pill_slot1=hub.pill_slot1,
        pill_slot2=hub.pill_slot2,
        pill_slot3=hub.pill_slot3,
        pill_slot4=getattr(hub, 'pill_slot4', False),
        air_ppm=hub.air_ppm,
        air_aqi=hub.air_aqi,
        flame=hub.flame,
        sos=reading.sos,
        fall=reading.fall,
        trigger=trigger,
        severity=severity,
    )
    if insight:
        console.print(f"  🤖 [bold cyan][AyuAgent] {insight.headline}[/]")
        await broadcast_to_dashboards("ai_insight", insight.to_dict())


async def _run_agent_hub(reading: HubReading, severity: str, trigger: str):
    """Run AI triage for a hub (environment) alert."""
    # Pick the primary patient for context
    if not engine.patients:
        return
    primary = next(iter(engine.patients.values()))

    insight = await ai_agent.analyze(
        patient_id=primary.id,
        patient_name=primary.name,
        age=primary.age,
        conditions=primary.conditions,
        hr=primary.hr,
        spo2=primary.spo2,
        temp=primary.temp,
        pill_slot1=reading.pill_slot1,
        pill_slot2=reading.pill_slot2,
        pill_slot3=reading.pill_slot3,
        pill_slot4=getattr(reading, 'pill_slot4', False),
        air_ppm=reading.air_ppm,
        air_aqi=reading.air_aqi,
        flame=reading.flame,
        sos=primary.sos if hasattr(primary, 'sos') else False,
        fall=primary.fall if hasattr(primary, 'fall') else False,
        trigger=trigger,
        severity=severity,
    )
    if insight:
        console.print(f"  🤖 [bold cyan][AyuAgent] {insight.headline}[/]")
        await broadcast_to_dashboards("ai_insight", insight.to_dict())


# ── Gateway WebSocket Client ────────────────────────────

async def connect_to_gateway():
    """Connect to the Gateway ESP32 WebSocket as a client."""
    global GATEWAY_CONNECTED
    import aiohttp

    while True:
        try:
            console.print(f"  [dim]Connecting to Gateway at {GATEWAY_WS_URL}...[/]")
            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(GATEWAY_WS_URL, timeout=5) as ws:
                    GATEWAY_CONNECTED = True
                    console.print(f"  [green]✓ Gateway connected![/]")
                    await broadcast_to_dashboards("gateway_status", {"connected": True})

                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            try:
                                data = json.loads(msg.data)
                                reading = VitalReading(
                                    patient_id=data.get("node", data.get("id", "UNKNOWN")),
                                    hr=data.get("hr", 0),
                                    spo2=data.get("oxy", data.get("spo2", 0)),
                                    temp=data.get("temp", 0.0),
                                    lat=data.get("lat", 0.0),
                                    lng=data.get("lng", 0.0),
                                    sos=data.get("sos", False),
                                    fall=data.get("fall", False),
                                    worn=data.get("worn", True),
                                    rssi=data.get("rssi", 0),
                                )
                                await handle_vital(reading)
                            except Exception as e:
                                console.print(f"  [yellow]Gateway parse error: {e}[/]")
                        elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            break

        except Exception as e:
            GATEWAY_CONNECTED = False
            console.print(f"  [dim]Gateway connection failed: {e}. Retrying in 5s...[/]")

        GATEWAY_CONNECTED = False
        await broadcast_to_dashboards("gateway_status", {"connected": False})
        await asyncio.sleep(5)


# ── Mock Stream Runner ──────────────────────────────────

async def run_mock_stream():
    """Run mock data generation."""
    global mock_stream
    try:
        mock_stream = MockDataStream()
        console.print(f"  [cyan]Mock IoT stream started ({len(config.DEMO_PATIENTS)} patient + hub)[/]")
        await mock_stream.run(on_vital=handle_vital, on_hub=handle_hub)
    except Exception as e:
        console.print(f"  [bold red]Mock stream error: {e}[/]")
        import traceback
        traceback.print_exc()


# ── Periodic Tasks ──────────────────────────────────────

async def periodic_state_broadcast():
    """Broadcast full state every 5 seconds for new dashboard connections."""
    while True:
        await asyncio.sleep(5)
        if dashboard_clients:
            await broadcast_full_state()
        # Check offline patients
        alerts = engine.check_offline_patients()
        for alert in alerts:
            await broadcast_alert(alert.model_dump())


# ── Terminal Status Display ─────────────────────────────

async def terminal_status_display():
    """Periodically print status to terminal."""
    while True:
        await asyncio.sleep(15)
        state = engine.get_dashboard_state()
        stats = state["stats"]
        table = Table(box=box.ROUNDED, title="[bold cyan]AyuLink Agent Status[/]", show_lines=True)
        table.add_column("Patient", style="bold")
        table.add_column("HR", justify="center")
        table.add_column("SpO2", justify="center")
        table.add_column("Status", justify="center")
        table.add_column("Risk", justify="center")

        for p in state["patients"]:
            hr_style = "red" if p["hr"] > 100 or (0 < p["hr"] < 55) else "green"
            spo2_style = "red" if 0 < p["spo2"] < 90 else "yellow" if 0 < p["spo2"] < 95 else "green"
            status_style = {"normal": "green", "warning": "yellow", "critical": "red", "offline": "dim"}.get(p["status"], "white")
            risk_style = "red" if p["risk_score"] > 70 else "yellow" if p["risk_score"] > 30 else "green"

            table.add_row(
                p["name"],
                f"[{hr_style}]{p['hr']}[/{hr_style}]",
                f"[{spo2_style}]{p['spo2']}%[/{spo2_style}]",
                f"[{status_style}]{p['status'].upper()}[/{status_style}]",
                f"[{risk_style}]{p['risk_score']}[/{risk_style}]",
            )

        console.print(table)
        console.print(f"  📦 Packets: {stats['total_packets']} | 🚨 Alerts: {stats['total_alerts']} | "
                      f"⏱ Uptime: {stats['uptime']}s | 🖥 Dashboards: {len(dashboard_clients)}")


# ── FastAPI App ─────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background tasks on server startup."""
    global ai_agent
    console.print(Panel.fit(
        "[bold cyan]AyuLink IoT Monitoring Agent[/]\n"
        "[dim]Remote Patient Monitoring System[/]",
        border_style="cyan",
    ))

    tasks = []

    # Initialize database
    db.init_db()

    # NOTE: P_01 slot removed — Patient 108 (Ramulu Goud) is the only real patient

    # Seed Patient 108 (REAL hardware patient)
    if not db.get_patient("108"):
        db.create_patient({
            "id": "108",
            "name": "Ramulu Goud",
            "age": 73,
            "gender": "Male",
            "village": "Hanamkonda",
            "conditions": ["Diabetes", "Hypertension", "Cardiac Risk"],
            "language": "Telugu",
            "lat": 17.9784,
            "lng": 79.5941,
            "device_status": "online",
        })
        console.print("  [bold green]✓ Patient 108 (Ramulu Goud) — REAL hardware — seeded[/]")

    # Initialize AI Agent
    try:
        ai_agent = AyuAgent(api_key=config.GROQ_API_KEY)
        console.print("  [bold cyan]AI Agent: Groq-powered triage active 🤖[/]")
    except Exception as e:
        console.print(f"  [yellow]AI Agent disabled: {e}[/]")
        ai_agent = None

    # Initialize Telegram Bot
    if config.TELEGRAM_ENABLED:
        try:
            tgbot.set_engine(engine)
            tg_app = await tgbot.start_bot(engine=engine, ai_agent=ai_agent, cam_url=esp32_cam_url)
            if tg_app:
                console.print(f"  [bold green]Telegram Bot: Active ✓ (chat: {config.TELEGRAM_CHAT_ID})[/]")
            else:
                console.print("  [yellow]Telegram Bot: Failed to start (check token)[/]")
        except Exception as te:
            console.print(f"  [yellow]Telegram Bot error: {te}[/]")

    if USE_MOCK:
        console.print("  [yellow]Mode: MOCK (simulated data — no real hardware)[/]")
        tasks.append(asyncio.create_task(run_mock_stream()))
    else:
        console.print(f"  [bold green]Mode: LIVE — waiting for Gateway ESP32 on /ws/gateway[/]")
        # Gateway connects TO us via /ws/gateway — do NOT try to connect to gateway
        # (connect_to_gateway() was resetting GATEWAY_CONNECTED=False every 5s)
        # Gateway connects TO us at /ws/gateway — no outbound task needed

    tasks.append(asyncio.create_task(periodic_state_broadcast()))
    tasks.append(asyncio.create_task(terminal_status_display()))
    tasks.append(asyncio.create_task(_camera_proxy_loop()))

    console.print(f"  [green]Dashboard: http://localhost:{BACKEND_PORT}[/]")
    console.print(f"  [green]API:       http://localhost:{BACKEND_PORT}/api/status[/]")
    console.print(f"  [green]AI Agent:  http://localhost:{BACKEND_PORT}/api/agent/insights[/]")
    console.print()

    yield

    # ── Shutdown ──────────────────────────────────────────
    for task in tasks:
        task.cancel()
    # Stop Telegram bot cleanly
    if config.TELEGRAM_ENABLED:
        await tgbot.stop_bot()


app = FastAPI(title="AyuLink IoT Agent", lifespan=lifespan)

# ── CORS — allow Next.js frontend + any LAN device ──────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve dashboard static files
dashboard_dir = Path(__file__).parent / "dashboard"
if dashboard_dir.exists():
    app.mount("/static", StaticFiles(directory=str(dashboard_dir)), name="dashboard_static")


# ── Routes ──────────────────────────────────────────────

@app.get("/")
async def serve_dashboard():
    """Serve the main dashboard page."""
    index_path = dashboard_dir / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return JSONResponse({"error": "Dashboard not found"}, status_code=404)


@app.get("/api/status")
async def api_status():
    """Get full system status."""
    state = engine.get_dashboard_state()
    state["gateway_connected"] = GATEWAY_CONNECTED and gateway_ws is not None
    state["use_mock"] = USE_MOCK
    state["dashboards_connected"] = len(dashboard_clients)
    return state


@app.post("/api/test-fall")
async def api_test_fall():
    """DEMO: Inject a fall event directly into the pipeline to test dashboard alerts."""
    reading = VitalReading(
        patient_id="108", hr=75, spo2=98, temp=36.8,
        lat=17.9784, lng=79.5941, fall=True, sos=False, worn=True,
    )
    await handle_vital(reading)
    return {"status": "fall event injected", "patient": "108"}


@app.post("/api/test-sos")
async def api_test_sos():
    """DEMO: Inject an SOS event directly into the pipeline to test dashboard alerts."""
    reading = VitalReading(
        patient_id="108", hr=110, spo2=96, temp=37.2,
        lat=17.9784, lng=79.5941, fall=False, sos=True, worn=True,
    )
    await handle_vital(reading)
    return {"status": "sos event injected", "patient": "108"}



@app.get("/api/live/patients")
async def api_live_patients():
    """Get live patients from engine (real-time vitals)."""
    return [p.model_dump() for p in engine.patients.values()]


@app.get("/api/live/patients/{patient_id}/history")
async def api_patient_history(patient_id: str):
    """Get recent vitals history from engine."""
    if patient_id in engine.vitals_history:
        readings = list(engine.vitals_history[patient_id])
        return [r.model_dump() for r in readings]
    return []


@app.get("/api/live/alerts")
async def api_live_alerts():
    """Get recent alerts from engine."""
    return [a.model_dump() for a in engine.alert_log[-50:]]


@app.get("/api/hub")
async def api_hub():
    """Get Smart Hub status."""
    return engine.hub_state.model_dump()


@app.get("/api/agent/insights")
async def api_agent_insights():
    """Get recent AI triage insights."""
    if ai_agent:
        return {"ok": True, "insights": ai_agent.get_recent_insights()}
    return {"ok": False, "insights": [], "error": "AI Agent not initialized"}


@app.get("/api/agent/monitor")
async def api_agent_monitor(n: int = 20):
    """Get the live AI monitoring narration log for the dashboard feed."""
    from ai_agent import get_monitor_log
    return {"ok": True, "log": get_monitor_log(n)}


@app.get("/api/agent/risk/{patient_id}")
async def api_agent_risk(patient_id: str):
    """Get predictive risk score for a patient from vital trends."""
    from ai_agent import compute_risk_score
    risk = compute_risk_score(patient_id)
    return {"ok": True, "patient_id": patient_id, "risk": risk}


@app.get("/api/agent/risk")
async def api_agent_risk_default():
    """Get predictive risk score for the primary patient (108)."""
    from ai_agent import compute_risk_score
    risk = compute_risk_score("108")
    return {"ok": True, "patient_id": "108", "risk": risk}


@app.post("/api/agent/analyze")
async def api_agent_analyze(
    patient_id: str = "P_01",
    trigger: str = "manual_request",
    severity: str = "warning",
):
    """Manually trigger an AI triage analysis (for demo / manual trigger)."""
    if not ai_agent:
        return {"ok": False, "error": "AI Agent not initialized"}

    patient_state = engine.patients.get(patient_id)
    if not patient_state:
        return {"ok": False, "error": f"Patient {patient_id} not found"}

    hub = engine.hub_state

    insight = await ai_agent.analyze(
        patient_id=patient_id,
        patient_name=patient_state.name,
        age=patient_state.age,
        conditions=patient_state.conditions,
        hr=patient_state.hr,
        spo2=patient_state.spo2,
        temp=patient_state.temp,
        pill_slot1=hub.pill_slot1,
        pill_slot2=hub.pill_slot2,
        pill_slot3=hub.pill_slot3,
        pill_slot4=getattr(hub, 'pill_slot4', False),
        air_ppm=hub.air_ppm,
        air_aqi=hub.air_aqi,
        flame=hub.flame,
        sos=False,
        fall=False,
        trigger=trigger,
        severity=severity,
    )
    if insight:
        await broadcast_to_dashboards("ai_insight", insight.to_dict())
        return {"ok": True, "insight": insight.to_dict()}
    return {"ok": False, "error": "Insight on cooldown or Groq error"}


@app.post("/api/agent/chat")
async def api_agent_chat(request: Request):
    """Multi-lingual AI chat with full patient + DB context + patient creation."""
    if not ai_agent:
        return {"ok": False, "error": "AI Agent not initialized"}

    body = await request.json()
    message = body.get("message", "")
    language = body.get("language", "en")

    if not message.strip():
        return {"ok": False, "error": "Empty message"}

    # Mental health distress detection
    if AyuAgent.detect_distress(message):
        result = await ai_agent.mental_health_response(message, language)
        return result

    lang_map = {"en": "English", "hi": "Hindi", "te": "Telugu"}
    lang_name = lang_map.get(language, "English")

    # ── Patient Registration Intent ────────────────────────
    import re
    patient_registration_keywords = [
        "register", "add patient", "new patient", "enroll", "create patient",
        "नया मरीज", "మరొక రోగి", "रजिस्टर", "నమోదు"
    ]
    is_registration = any(kw in message.lower() for kw in patient_registration_keywords)

    if is_registration:
        # Use AI to extract structured patient data
        extract_prompt = (
            "Extract patient registration data from this message. "
            "Return ONLY a valid JSON object with these fields: "
            "name (string), age (integer, default 0), village (string, default 'Unknown'), "
            "conditions (list of strings, e.g. ['Diabetes']), gender (string, default 'Unknown'), "
            "language (string: Telugu/Hindi/English). "
            "If a field is not mentioned, use the default. "
            f"Message: {message}"
        )
        try:
            extract_r = await ai_agent.client.chat.completions.create(
                model=os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"),
                messages=[
                    {"role": "system", "content": "You are a data extractor. Return only valid JSON. No markdown."},
                    {"role": "user", "content": extract_prompt},
                ],
                max_tokens=200, temperature=0.1,
            )
            raw = extract_r.choices[0].message.content.strip()
            # Strip markdown code fences if present
            raw = re.sub(r"```json|```", "", raw).strip()
            patient_data = json.loads(raw)
            if patient_data.get("name"):
                # ── Duplicate name check ──────────────────────────────
                existing = db.get_all_patients()
                patient_name_lower = patient_data["name"].strip().lower()
                duplicate = next(
                    (p for p in existing if p["name"].strip().lower() == patient_name_lower),
                    None
                )
                if duplicate:
                    return {
                        "ok": True,
                        "reply": (
                            f"⚠️ A patient named **{duplicate['name']}** (ID: {duplicate['id']}) "
                            f"is already registered in the system.\n"
                            f"Age: {duplicate.get('age', 'N/A')}, Village: {duplicate.get('village', 'N/A')}, "
                            f"Conditions: {', '.join(duplicate.get('conditions', [])) or 'None'}.\n\n"
                            f"If this is a different person, please provide a slightly different name (e.g. include last name)."
                        ),
                        "language": language,
                    }
                new_patient = db.create_patient(patient_data)
                # Register in live engine so it appears immediately on dashboard
                engine.patients.setdefault(new_patient["id"], PatientState(
                    id=new_patient["id"], name=new_patient["name"],
                    age=new_patient.get("age", 0), village=new_patient.get("village", ""),
                    conditions=new_patient.get("conditions", []),
                ))
                confirm_msg = (
                    f"✅ Patient registered successfully!\n"
                    f"Name: {new_patient['name']}\n"
                    f"ID: {new_patient['id']}\n"
                    f"Age: {new_patient.get('age', 'N/A')}\n"
                    f"Village: {new_patient.get('village', 'N/A')}\n"
                    f"Conditions: {', '.join(new_patient.get('conditions', [])) or 'None'}\n\n"
                    f"The patient has been added to the AyuLink database and will appear on all dashboards."
                )
                return {
                    "ok": True,
                    "reply": confirm_msg,
                    "language": language,
                    "patient_created": True,
                    "patient_name": new_patient["name"],
                    "patient_id": new_patient["id"],
                }
        except Exception as e:
            console.print(f"  [yellow]Patient extraction failed: {e}[/]")

    # ── Standard Chat with Full DB Context ────────────────
    db_summary = db.get_all_patients_summary()

    # Live patient data from engine
    live_patients = []
    for pid, ps in engine.patients.items():
        live_patients.append(
            f"{ps.name} (ID:{pid}): HR={ps.hr}, SpO2={ps.spo2}%, "
            f"Temp={ps.temp}°C, Status={ps.status}, Risk={ps.risk_score}"
        )
    live_ctx = "\n".join(live_patients) if live_patients else "No live patient data."

    hub = engine.hub_state
    env_ctx = (
        f"Air: {hub.air_ppm}PPM ({hub.air_aqi}), "
        f"Flame: {'YES' if hub.flame else 'No'}, "
        f"Pills: AM={'✓' if hub.pill_slot1 else '✗'} PM={'✓' if hub.pill_slot2 else '✗'} "
        f"Eve={'✓' if hub.pill_slot3 else '✗'} Ngt={'✓' if getattr(hub, 'pill_slot4', False) else '✗'}"
    )

    # Enrich with per-patient history if name/ID mentioned
    report_ctx = ""
    for p in db.get_all_patients():
        if p["name"].lower() in message.lower() or p["id"].lower() in message.lower():
            reports = db.get_patient_reports(p["id"])
            if reports:
                report_ctx += f"\nReports for {p['name']}: " + "; ".join(
                    [f"{r['title']} ({r['type']})" for r in reports[:5]]
                )
            vitals = db.get_vitals_history(p["id"], limit=5)
            if vitals:
                report_ctx += f"\nRecent vitals: " + "; ".join(
                    [f"HR={v['hr']},SpO2={v['spo2']}" for v in vitals]
                )

    # Recent alerts context
    alert_ctx = ""
    recent_alerts = db.get_alerts_history(limit=5)
    if recent_alerts:
        alert_ctx = "\nRECENT ALERTS:\n" + "\n".join(
            [f"- {a['severity'].upper()}: {a['message']}" for a in recent_alerts]
        )

    system_prompt = (
        "You are AyuLink AI — medical triage assistant for eldercare IoT. "
        "Context is provided automatically (database, vitals, environment, alerts). "
        f"Respond in {lang_name}. "
        "CRITICAL RULES: \n"
        "1. ONLY answer the specific QUESTION asked. Do NOT summarize unrequested sensors, vitals, or database status.\n"
        "2. If the user asks about a specific patient, only discuss that patient.\n"
        "3. If the user asks about alerts, only discuss alerts.\n"
        "4. Be very concise (1-2 sentences). Do not volunteer extra information."
    )

    user_prompt = (
        f"DATABASE:\n{db_summary}\n\n"
        f"LIVE VITALS:\n{live_ctx}\n\n"
        f"ENVIRONMENT: {env_ctx}\n"
        f"{alert_ctx}\n"
        f"{report_ctx}\n\n"
        f"QUESTION: {message}"
    )

    try:
        r = await ai_agent.client.chat.completions.create(
            model=os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=250, temperature=0.5,
        )
        return {"ok": True, "reply": r.choices[0].message.content, "language": language}
    except Exception as e:
        console.print(f"[red]Groq API Error: {repr(e)}[/]")
        fallback_reply = "I'm currently unable to process complex requests due to high network load. However, you can see live vitals and alerts clearly on the dashboard."
        return {"ok": True, "reply": fallback_reply, "language": language, "error_details": repr(e)}


@app.post("/api/agent/clear")
async def api_agent_clear():
    """Clear all AI insights history."""
    if ai_agent:
        ai_agent.clear_insights()
    return {"ok": True}


@app.post("/api/agent/medical-search")
async def api_medical_search(request: Request):
    """Medical knowledge search engine — medicines, diseases, treatments."""
    if not ai_agent:
        return {"ok": False, "error": "AI Agent not initialized. Please set a Groq API key."}

    body = await request.json()
    query = body.get("query", "").strip()
    search_type = body.get("type", "auto")  # auto | medicine | disease | symptom
    language = body.get("language", "en")

    if not query:
        return {"ok": False, "error": "Empty query"}

    lang_map = {"en": "English", "hi": "Hindi", "te": "Telugu"}
    lang_name = lang_map.get(language, "English")

    # Detect search type if auto
    medicine_keywords = ["tablet", "medicine", "drug", "pill", "capsule", "syrup", "injection",
                         "metformin", "amlodipine", "atorvastatin", "aspirin", "paracetamol",
                         "amoxicillin", "dose", "dosage", "mg", "brand"]
    disease_keywords = ["disease", "condition", "syndrome", "disorder", "fever", "diabetes",
                        "hypertension", "cancer", "infection", "malaria", "dengue", "covid",
                        "tuberculosis", "anaemia", "anemia", "stroke", "heart attack", "arthritis"]
    symptom_keywords = ["symptom", "pain", "ache", "swelling", "fatigue", "cough", "breathless",
                        "dizzy", "nausea", "vomit", "rash", "itching", "burning", "bleeding"]

    q_lower = query.lower()
    if search_type == "auto":
        if any(k in q_lower for k in medicine_keywords):
            search_type = "medicine"
        elif any(k in q_lower for k in disease_keywords):
            search_type = "disease"
        elif any(k in q_lower for k in symptom_keywords):
            search_type = "symptom"
        else:
            search_type = "general"

    # Build structured prompt
    if search_type == "medicine":
        system_prompt = (
            "You are a clinical pharmacist AI. Provide detailed, accurate medicine information. "
            "ALWAYS respond with a valid JSON object (no markdown). "
            "JSON schema: {\"name\": str, \"type\": \"medicine\", \"generic_name\": str, \"brand_names\": [str], "
            "\"drug_class\": str, \"overview\": str (2-3 sentences), "
            "\"uses\": [str] (list of conditions), "
            "\"dosage\": {\"adult\": str, \"elderly\": str, \"child\": str}, "
            "\"side_effects\": {\"common\": [str], \"serious\": [str]}, "
            "\"contraindications\": [str], \"interactions\": [str], "
            "\"storage\": str, \"available_in_india\": bool, "
            "\"when_to_seek_help\": str, \"related_drugs\": [str]}"
        )
    elif search_type == "disease":
        system_prompt = (
            "You are a clinical medicine AI. Provide detailed disease information. "
            "ALWAYS respond with a valid JSON object (no markdown). "
            "JSON schema: {\"name\": str, \"type\": \"disease\", \"category\": str, "
            "\"overview\": str (2-3 sentences), \"causes\": [str], \"symptoms\": [str], "
            "\"risk_factors\": [str], \"diagnosis\": [str], "
            "\"treatment\": {\"lifestyle\": [str], \"medications\": [str], \"procedures\": [str]}, "
            "\"prevention\": [str], \"prognosis\": str, \"when_to_seek_help\": str, "
            "\"icd_code\": str, \"prevalence_india\": str}"
        )
    elif search_type == "symptom":
        system_prompt = (
            "You are a clinical triage AI. Analyze symptoms and provide guidance. "
            "ALWAYS respond with a valid JSON object (no markdown). "
            "JSON schema: {\"symptom\": str, \"type\": \"symptom\", \"overview\": str, "
            "\"possible_causes\": [{\"condition\": str, \"severity\": str, \"probability\": str}], "
            "\"red_flags\": [str], \"self_care\": [str], \"when_to_see_doctor\": str, "
            "\"tests_commonly_ordered\": [str], \"related_symptoms\": [str]}"
        )
    else:
        system_prompt = (
            "You are a medical knowledge AI. Answer the medical query with structured information. "
            "ALWAYS respond with a valid JSON object (no markdown). "
            "JSON schema: {\"topic\": str, \"type\": \"general\", \"overview\": str, "
            "\"key_points\": [str], \"clinical_significance\": str, "
            "\"related_topics\": [str], \"references\": [str]}"
        )

    try:
        r = await ai_agent.client.chat.completions.create(
            model=os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Query: {query}\nRespond in {lang_name}. Return ONLY valid JSON."},
            ],
            max_tokens=800, temperature=0.2,
        )
        raw = r.choices[0].message.content.strip()
        # Strip markdown fences
        import re
        raw = re.sub(r"```json|```", "", raw).strip()
        # Find JSON object
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            result_data = json.loads(match.group())
            result_data["search_type"] = search_type
            result_data["query"] = query
            return {"ok": True, "result": result_data, "search_type": search_type}
        else:
            return {"ok": True, "result": {"type": "general", "overview": raw, "query": query}, "search_type": "general"}
    except json.JSONDecodeError:
        return {"ok": True, "result": {"type": "general", "overview": raw, "query": query}, "search_type": "general"}
    except Exception as e:
        return {"ok": False, "error": f"Search failed: {str(e)}"}


@app.post("/api/agent/apikey")
async def api_agent_apikey(request: Request):
    """Hot-swap Groq API key at runtime."""
    body = await request.json()
    new_key = body.get("api_key", "").strip()
    if not new_key:
        return {"ok": False, "error": "No API key provided"}
    if ai_agent:
        ai_agent.update_api_key(new_key)
        return {"ok": True, "message": "API key updated"}
    return {"ok": False, "error": "Agent not initialized"}


@app.get("/api/agent/apikey")
async def api_agent_get_apikey():
    """Get masked current API key."""
    if ai_agent and ai_agent.api_key:
        key = ai_agent.api_key
        masked = key[:8] + "..." + key[-4:]
        return {"ok": True, "masked_key": masked}
    return {"ok": False}


# ── Patient Database Endpoints ──

@app.get("/api/patients")
async def api_get_patients():
    return {"ok": True, "patients": db.get_all_patients(), "count": db.get_patient_count()}


@app.get("/api/patients/{patient_id}")
async def api_get_patient(patient_id: str):
    p = db.get_patient(patient_id)
    if p:
        p["reports"] = db.get_patient_reports(patient_id)
        p["vitals_history"] = db.get_vitals_history(patient_id, limit=20)
        return {"ok": True, "patient": p}
    return {"ok": False, "error": "Not found"}


@app.post("/api/patients")
async def api_create_patient(request: Request):
    body = await request.json()
    patient = db.create_patient(body)
    return {"ok": True, "patient": patient}


@app.delete("/api/patients/{patient_id}")
async def api_delete_patient(patient_id: str):
    db.delete_patient(patient_id)
    return {"ok": True}


# ── Reports ──

@app.get("/api/reports/{patient_id}")
@app.get("/api/patients/{patient_id}/reports")
async def api_get_reports(patient_id: str):
    return {"ok": True, "reports": db.get_patient_reports(patient_id)}


@app.get("/api/vitals/history/{patient_id}")
async def api_get_vitals_history(patient_id: str, limit: int = 50):
    history = db.get_vitals_history(patient_id, limit=limit)
    return {"ok": True, "history": history, "patient_id": patient_id}


@app.get("/api/alerts/history")
async def api_get_alerts_history(limit: int = 100):
    return {"ok": True, "alerts": db.get_alerts_history(limit=limit)}


@app.post("/api/reports")
async def api_create_report(request: Request):
    body = await request.json()
    report = db.create_report(
        patient_id=body.get("patient_id", ""),
        title=body.get("title", ""),
        content=body.get("content", ""),
        report_type=body.get("type", "general"),
        image_b64=body.get("image_b64", ""),
    )
    return {"ok": True, "report": report}


@app.delete("/api/reports/{report_id}")
async def api_delete_report(report_id: str):
    db.delete_report(report_id)
    return {"ok": True}


# ── Notifications ──

@app.get("/api/notifications")
async def api_get_notifications():
    return {"ok": True, "notifications": db.get_notifications()}


@app.post("/api/notifications")
async def api_send_notification(request: Request):
    body = await request.json()
    notif = db.create_notification(
        patient_id=body.get("patient_id", ""),
        title=body.get("title", ""),
        message=body.get("message", ""),
        ntype=body.get("type", "info"),
    )

    # ── ASCII-only sanitization for OLED displays ─────────────────────────────
    # SH1106 / SSD1306 only render ASCII (0x20-0x7E). Strip everything else.
    def to_ascii(text: str) -> str:
        import unicodedata
        # Normalize and drop non-ASCII
        normalized = unicodedata.normalize("NFKD", text)
        ascii_only = normalized.encode("ascii", errors="ignore").decode("ascii")
        # Remove any remaining non-printable chars
        return "".join(c for c in ascii_only if 0x20 <= ord(c) <= 0x7E).strip()

    oled_title = to_ascii(notif["title"]) or "AyuLink Alert"
    oled_msg   = to_ascii(notif["message"]) or "You have a new message."

    notif_payload = json.dumps({
        "cmd":   "notification",
        "notif": oled_msg[:80],    # max 80 chars for OLED word-wrap
        "msg":   oled_msg[:80],    # for NodeMCU dispenser compatibility
        "title": oled_title[:18],  # max 18 chars per OLED line
        "type":  notif["type"],
    })
    # Forward to ESP32-S3 Smart Hub OLED (always — dashboard notifications must show)
    if hub_ws:
        try:
            await hub_ws.send_text(notif_payload)
            db.mark_notification_sent(notif["id"], to_device=True)
            notif["sent_to_device"] = True
            console.print(f"  [cyan]💬 Hub OLED ← '{oled_msg[:30]}'[/]")
        except Exception as e:
            console.print(f"  [yellow]⚠ Hub send failed: {e}[/]")
    # Forward to Gateway ESP32 → LoRa → Wristband (always — dashboard notifications must show)
    if gateway_ws:
        try:
            # Send compact LoRa-safe payload (<100 bytes)
            lora_payload = json.dumps({
                "cmd":   "notification",
                "title": oled_title[:18],
                "notif": oled_msg[:50],   # 50 chars fits safely in LoRa packet
            })
            await gateway_ws.send_text(lora_payload)
            console.print(f"  [green]📡 Gateway → LoRa → Wristband ← '{oled_msg[:30]}'[/]")
            with open("/tmp/backend_notif_debug.log", "a") as f:
                f.write(f"SENT TO GATEWAY: {lora_payload}\n")
        except Exception as e:
            console.print(f"  [red]⚠ Gateway send failed: {e}[/]")
            with open("/tmp/backend_notif_debug.log", "a") as f:
                f.write(f"GATEWAY SEND FAILED: {e}\n")
    else:
        console.print(f"  [yellow]⚠ Gateway not connected — notification NOT forwarded to wristband![/]")
        with open("/tmp/backend_notif_debug.log", "a") as f:
            f.write(f"GATEWAY NOT CONNECTED\n")
    await broadcast_to_dashboards("notification", notif)
    return {"ok": True, "notification": notif}


@app.post("/api/clear-oled")
async def api_clear_oled():
    """Clear notification overlay on Gateway OLED + send LoRa clear to wristband."""
    clear_payload = json.dumps({"cmd": "clear"})
    if gateway_ws:
        try:
            await gateway_ws.send_text(clear_payload)
            console.print("  [dim]🖥  OLED cleared via Gateway[/]")
        except Exception:
            pass
    if hub_ws:
        try:
            await hub_ws.send_text(clear_payload)
        except Exception:
            pass
    return {"ok": True}


@app.post("/api/simulate")
async def api_simulate_event(request: Request):
    """Simulate a wristband event. Always fires alert bypassing all cooldowns."""
    body = await request.json()
    event = body.get("event", "fall")
    patient_id = body.get("patient_id", "P_01")
    state = engine.patients.get(patient_id)
    patient_name = state.name if state else ""
    if not patient_name:
        # Fallback to DB
        try:
            p = db.get_patient(patient_id)
            if p: patient_name = p.get("name", "")
        except Exception:
            pass
    if not patient_name:
        patient_name = f"Patient {patient_id}"

    # Clear threshold engine cooldown so alert always fires
    key = f"{patient_id}:fall" if event == "fall" else f"{patient_id}:{event}"
    engine._cooldowns.pop(key, None)
    engine._cooldowns.pop(f"{patient_id}:sos", None)
    # Clear OLED cooldown too
    _last_oled_alert.pop(patient_id, None)

    reading = VitalReading(
        patient_id=patient_id,
        hr=145 if event == "hr_high" else 72,
        spo2=78  if event == "spo2_low" else 97,
        temp=37.2, bp_systolic=130, bp_diastolic=85,
        sos=(event == "sos"), fall=(event == "fall"),
        worn=True, rssi=-65,
    )

    # Directly broadcast the alert without cooldown for testing
    import unicodedata as _ud
    def _ascii(t): return "".join(c for c in _ud.normalize("NFKD",t).encode("ascii","ignore").decode("ascii") if 0x20<=ord(c)<=0x7E).strip()
    title  = "FALL DETECTED" if event=="fall" else "SOS ALERT" if event=="sos" else event.upper()
    msg    = f"{patient_name}: {title} — HR:{reading.hr} SpO2:{reading.spo2}%"
    alert_dict = {
        "id": "sim", "patient_id": patient_id, "patient_name": patient_name,
        "alert_type": event, "severity": "emergency",
        "message": msg, "value": event.upper(),
        "vitals_snapshot": {"hr": reading.hr, "spo2": reading.spo2, "temp": reading.temp, "bp_sys": reading.bp_systolic},
    }
    await broadcast_alert(alert_dict)

    # Also run through engine pipeline for proper state updates
    await handle_vital(reading)

    # Forward to Gateway OLED — use cmd:"emergency" for full-screen alert
    if gateway_ws:
        try:
            await gateway_ws.send_text(json.dumps({
                "cmd":   "emergency",
                "type":  event,  # "fall" or "sos"
                "title": _ascii(title)[:18],
                "notif": _ascii(msg)[:80],
                "severity": "emergency",
            }))
        except Exception:
            pass

    console.print(f"  [bold red]🧪 SIMULATED {event.upper()} for {patient_name}[/]")
    return {"ok": True, "simulated": event, "patient": patient_name, "alert_broadcast": True}


@app.post("/api/dispatch")
async def api_dispatch_paramedic(request: Request):
    """Dispatch paramedic alert — broadcasts to all dashboards + Gateway OLED + Wristband."""
    body = await request.json()
    patient_id = body.get("patient_id", "P_01")
    patient_state = engine.patients.get(patient_id)
    patient_name = patient_state.name if patient_state else patient_id

    dispatch_data = {
        "patient_id": patient_id,
        "patient_name": patient_name,
        "location": body.get("location", "Hanamkonda, Warangal"),
        "message": f"PARAMEDIC DISPATCHED for {patient_name}",
        "timestamp": time.time(),
    }

    # Alert all dashboards
    await broadcast_to_dashboards("dispatch", dispatch_data)

    # Send to Gateway → OLED + buzzer
    cmd_payload = json.dumps({"cmd": "dispatch", "notif": f"DISPATCH: {patient_name}", "severity": "emergency"})
    if gateway_ws:
        try:
            await gateway_ws.send_text(cmd_payload)
        except Exception:
            pass
    if hub_ws:
        try:
            await hub_ws.send_text(cmd_payload)
        except Exception:
            pass

    # Save to DB as notification
    db.create_notification(
        patient_id=patient_id,
        title="Paramedic Dispatched",
        message=dispatch_data["message"],
        ntype="emergency",
    )
    return {"ok": True, "dispatch": dispatch_data}


# ── ESP32-CAM ──

@app.get("/api/camera")
async def api_get_camera():
    return {"ok": True, "url": esp32_cam_url}


@app.post("/api/camera")
async def api_set_camera(request: Request):
    global esp32_cam_url
    body = await request.json()
    esp32_cam_url = body.get("url", "").strip()
    _save_cam_url(esp32_cam_url)  # persist so it survives restarts
    if config.TELEGRAM_ENABLED:
        tgbot.set_cam_url(esp32_cam_url)
    await broadcast_to_dashboards("camera_url", {"url": esp32_cam_url})
    return {"ok": True, "url": esp32_cam_url}

@app.get("/api/stream")
async def api_video_stream():
    """MJPEG stream proxy for the frontend."""
    async def frame_generator():
        global latest_cam_frame
        while True:
            if latest_cam_frame:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + latest_cam_frame + b'\r\n')
            await asyncio.sleep(0.05)  # ~20 FPS max
            
    from fastapi.responses import StreamingResponse
    return StreamingResponse(frame_generator(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.get("/api/snapshot")
async def api_snapshot():
    """Return a single JPEG frame for the Telegram bot to fetch."""
    global latest_cam_frame
    from fastapi.responses import Response
    if latest_cam_frame:
        return Response(content=latest_cam_frame, media_type="image/jpeg")
    return Response(content=b"", media_type="image/jpeg", status_code=404)


# ── Alerts History ──

@app.get("/api/alerts")
async def api_get_alerts():
    return {"ok": True, "alerts": db.get_alerts_history()}

@app.post("/api/simulate/{event_type}")
async def api_simulate(event_type: str, patient_id: str = "P_01"):
    """Trigger a demo event (sos, fall, cardiac, flame)."""
    if mock_stream:
        mock_stream.trigger_event(event_type, patient_id)
        return {"ok": True, "event": event_type, "patient": patient_id}
    return {"ok": False, "error": "Not in mock mode"}


@app.post("/api/dispense/{slot}")
async def api_dispense(slot: int):
    """Command the ESP32-S3 Hub to dispense pill from a slot."""
    if hub_ws:
        try:
            await hub_ws.send_text(json.dumps({"cmd": "dispense", "slot": slot}))
            return {"ok": True, "slot": slot}
        except Exception:
            return {"ok": False, "error": "Hub disconnected"}
    # In mock mode, simulate
    if mock_stream:
        if 1 <= slot <= 4:
            idx = slot - 1
            if hasattr(mock_stream, 'hub') and hasattr(mock_stream.hub, 'pill_taken'):
                if idx < len(mock_stream.hub.pill_taken):
                    mock_stream.hub.pill_taken[idx] = True
                    # Let's immediately broadcast this change to the dashboard
                    reading = mock_stream.hub.generate_reading()
                    await handle_hub(reading)
            return {"ok": True, "slot": slot, "simulated": True}
    return {"ok": False, "error": "No hub connected"}


@app.post("/api/neopixel")
async def api_neopixel(r: int = 0, g: int = 255, b: int = 0):
    """Set NeoPixel color on the ESP32-S3 Hub."""
    if hub_ws:
        try:
            await hub_ws.send_text(json.dumps({"cmd": "led", "r": r, "g": g, "b": b}))
            return {"ok": True}
        except Exception:
            return {"ok": False, "error": "Hub disconnected"}
    return {"ok": False, "error": "No hub connected"}


# ── WebSocket Endpoints ─────────────────────────────────

@app.websocket("/ws/dashboard")
async def websocket_dashboard(websocket: WebSocket):
    """WebSocket endpoint for dashboard clients."""
    await websocket.accept()
    dashboard_clients.add(websocket)
    console.print(f"  [green]Dashboard connected ({len(dashboard_clients)} total)[/]")

    # Send initial state
    state = engine.get_dashboard_state()
    await websocket.send_text(json.dumps({"event": "state", "data": state}))

    # Replay any emergency alerts from the last 30 seconds (so reconnects don't miss them)
    now = time.time()
    for buffered in list(_emergency_buffer):
        if now - buffered["ts"] <= 30:
            try:
                await websocket.send_text(json.dumps({"event": "alert", "data": buffered["data"]}))
            except Exception:
                pass

    try:
        while True:
            data = await websocket.receive_text()
            # Handle dashboard commands
            try:
                cmd = json.loads(data)
                if cmd.get("action") == "simulate":
                    if mock_stream:
                        mock_stream.trigger_event(cmd.get("event", "sos"), cmd.get("patient_id", "P_01"))
                elif cmd.get("action") == "dispense":
                    slot = cmd.get("slot", 1)
                    if cmd.get("reset"):
                        # Reset slot: send reset_slot to ESP32 hub
                        if hub_ws:
                            try:
                                await hub_ws.send_text(json.dumps({"cmd": "reset_slot", "slot": slot}))
                            except Exception:
                                pass
                        if mock_stream:
                            idx = slot - 1
                            if 0 <= idx < len(mock_stream.hub.pill_taken):
                                mock_stream.hub.pill_taken[idx] = False
                                reading = mock_stream.hub.generate_reading()
                                await handle_hub(reading)
                    else:
                        await api_dispense(slot)
                elif cmd.get("action") == "reset_all":
                    # Relay to ESP32 hub
                    if hub_ws:
                        try:
                            await hub_ws.send_text(json.dumps({"cmd": "reset_all"}))
                        except Exception:
                            pass
                    if mock_stream:
                        for i in range(len(mock_stream.hub.pill_taken)):
                            mock_stream.hub.pill_taken[i] = False
                        reading = mock_stream.hub.generate_reading()
                        await handle_hub(reading)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        dashboard_clients.discard(websocket)
        console.print(f"  [dim]Dashboard disconnected ({len(dashboard_clients)} remaining)[/]")


@app.websocket("/ws/hub")
async def websocket_hub(websocket: WebSocket):
    """WebSocket endpoint for ESP32-S3 Smart Hub."""
    global hub_ws
    await websocket.accept()
    hub_ws = websocket
    console.print("  [green]✓ Smart Hub (ESP32-S3) connected![/]")
    await broadcast_to_dashboards("hub_status", {"connected": True})

    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
                if payload.get("type") == "hub_data":
                    reading = HubReading(
                        air_ppm=payload.get("air_ppm", 0),
                        air_aqi=payload.get("air_aqi", "Unknown"),
                        flame=payload.get("flame", False),
                        env_temp=payload.get("env_temp", 0.0),
                        humidity=payload.get("humidity", 0.0),
                        rtc_time=payload.get("rtc_time", ""),
                        rtc_date=payload.get("rtc_date", ""),
                        pill_slot1=payload.get("pill_slot1", False),
                        pill_slot2=payload.get("pill_slot2", False),
                        pill_slot3=payload.get("pill_slot3", False),
                        pill_slot4=payload.get("pill_slot4", False),
                        rssi=payload.get("rssi", 0),
                        uptime=payload.get("uptime", 0),
                    )
                    await handle_hub(reading)
            except Exception as e:
                console.print(f"  [yellow]Hub parse error: {e}[/]")
    except WebSocketDisconnect:
        pass
    finally:
        hub_ws = None
        engine.hub_state.online = False
        console.print("  [dim]Smart Hub disconnected[/]")
        await broadcast_to_dashboards("hub_status", {"connected": False})


@app.websocket("/ws/gateway")
async def websocket_gateway(websocket: WebSocket):
    """WebSocket endpoint for Gateway ESP32 (acts as LoRa→WiFi bridge)."""
    global gateway_ws, GATEWAY_CONNECTED, USE_MOCK, mock_stream
    await websocket.accept()
    gateway_ws = websocket
    GATEWAY_CONNECTED = True
    # ── Auto-switch to LIVE mode when real gateway connects ──
    USE_MOCK = False
    if mock_stream:
        console.print("  [yellow]⚡ Real Gateway connected → Mock stream suspended. Real data only.[/]")
    console.print("  [green]✓ Gateway ESP32 connected via WebSocket![/]")
    await broadcast_to_dashboards("gateway_status", {"connected": True, "live": True})

    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
                # Skip gateway identify / handshake packets
                if payload.get("type") in ("identify", "gateway_heartbeat", "gateway_info"):
                    await broadcast_to_dashboards("gateway_heartbeat", payload)
                    continue

                # Accept both 'node' (new firmware) and 'id' (old firmware)
                node_id = payload.get("node") or payload.get("patient_id") or payload.get("id", "")

                # Skip gateway self-reports
                if node_id.upper() in ("GATEWAY", "HUB", ""):
                    continue

                # ── Backwards compat: map old string 'alert' field to booleans ──
                alert_str = str(payload.get("alert", "")).upper()
                if alert_str == "SOS":
                    payload["sos"]  = True
                    payload["fall"] = False
                elif alert_str in ("FALL", "FALL_DETECTED"):
                    payload["fall"] = True
                    payload["sos"]  = False

                is_sos  = bool(payload.get("sos",  False))
                is_fall = bool(payload.get("fall", False))
                is_tremor = bool(payload.get("tremor", False))

                if is_sos or is_fall or is_tremor:
                    console.print(f"  [bold red]🚨 EMERGENCY PKT from LoRa: fall={is_fall} sos={is_sos} tremor={is_tremor} node={node_id}[/]")

                import random as _rnd, math as _math
                _t = __import__('time').time()
                _bp_sys = int(125 + _math.sin(_t * 0.005) * 8 + _rnd.randint(-4, 4))
                _bp_dia = int(82 + _math.sin(_t * 0.007) * 5 + _rnd.randint(-3, 3))
                reading = VitalReading(
                    patient_id=node_id,
                    hr=payload.get("hr", 0),
                    spo2=payload.get("oxy", payload.get("spo2", 0)),
                    temp=payload.get("temp", 0.0),
                    bp_systolic=payload.get("bp_sys", _bp_sys),
                    bp_diastolic=payload.get("bp_dia", _bp_dia),
                    lat=payload.get("lat", 18.0539),
                    lng=payload.get("lng", 79.5357),
                    sos=is_sos,
                    fall=is_fall,
                    tremor=is_tremor,
                    worn=payload.get("worn", True),
                    rssi=payload.get("rssi", payload.get("loraRssi", 0)),
                )
                await handle_vital(reading)
                # Persist to DB
                db.save_vital(reading.patient_id, reading.hr, reading.spo2,
                              reading.temp, reading.fall, reading.sos, 0)

                # ── Immediately push emergency cmd to Gateway OLED for SOS/Fall/FIDS ──
                # (handle_vital will also do this but only after cooldown; bypass here)
                if (is_sos or is_fall or is_tremor) and gateway_ws:
                    try:
                        import unicodedata as _ud
                        def _asc(t): return "".join(c for c in _ud.normalize("NFKD",t).encode("ascii","ignore").decode("ascii") if 0x20<=ord(c)<=0x7E).strip()
                        state = engine.patients.get(node_id)
                        pname = state.name if state else node_id
                        if is_sos:
                            title = "SOS ALERT"
                            etype = "sos"
                        elif is_tremor:
                            title = "FIDS DETECTED"
                            etype = "fids"
                        else:
                            title = "FALL DETECTED"
                            etype = "fall"
                        msg   = f"{pname}: {title}"
                        await gateway_ws.send_text(json.dumps({
                            "cmd":      "emergency",
                            "type":     etype,
                            "title":    _asc(title)[:18],
                            "notif":    _asc(msg)[:80],
                            "severity": "emergency",
                        }))
                    except Exception:
                        pass
            except Exception as e:
                import traceback
                console.print(f"  [red]Gateway parse error: {e}[/]")
                console.print(traceback.format_exc())
    except WebSocketDisconnect:
        pass
    finally:
        gateway_ws = None
        GATEWAY_CONNECTED = False
        USE_MOCK = True  # Resume mock so dashboard isn't empty
        console.print("  [dim]Gateway ESP32 disconnected — resuming mock stream[/]")
        await broadcast_to_dashboards("gateway_status", {"connected": False, "live": False})


# ── Entry Point ─────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AyuLink IoT Monitoring Agent")
    parser.add_argument("--mock", action="store_true", default=True,
                        help="Use mock data stream (default)")
    parser.add_argument("--live", action="store_true",
                        help="Connect to live Gateway ESP32")
    parser.add_argument("--gateway", type=str, default=None,
                        help="Gateway IP address (default: 192.168.4.1)")
    parser.add_argument("--port", type=int, default=BACKEND_PORT,
                        help="Server port (default: 8000)")
    args = parser.parse_args()

    if args.live:
        USE_MOCK = False
    if args.gateway:
        import config as cfg
        cfg.GATEWAY_IP = args.gateway
        cfg.GATEWAY_WS_URL = f"ws://{args.gateway}:{cfg.GATEWAY_WS_PORT}"

    import uvicorn
    uvicorn.run(app, host=BACKEND_HOST, port=args.port, log_level="warning")
