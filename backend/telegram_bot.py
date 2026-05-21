"""
AyuLink Telegram Bot — ENHANCED
New commands: /risk /trend /brief /ask
Multilingual emergency alerts (EN/TE/HI)
Inline 108 button on SOS/Fall
"""
import asyncio, os, time, httpx, logging, io, re
from typing import Optional
from gtts import gTTS
from telegram import Update, Bot, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import Application, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes
from telegram.error import TelegramError

logger = logging.getLogger(__name__)

# ── Strip emojis and markdown for clean TTS ───────────────────────────────────
_EMOJI_RE = re.compile(
    "[\U00010000-\U0010ffff"
    "\U0001F600-\U0001F64F\U0001F300-\U0001F5FF"
    "\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF"
    "\u2600-\u26FF\u2700-\u27BF\u200d\ufe0f"
    "\u23cf\u23e9\u231a\u25aa\u25ab\u25b6\u25c0"
    "\u2934\u2935\u25fb-\u25fe\u2614\u2615"
    "\u2648-\u2653\u267f\u2693\u26a1\u26aa\u26ab"
    "\u26bd\u26be\u26c4\u26c5\u26ce\u26d4\u26ea"
    "\u26f2\u26f3\u26f5\u26fa\u26fd\u2702\u2705"
    "\u2708-\u270d\u270f\u2712\u2714\u2716\u271d"
    "\u2721\u2728\u2733\u2734\u2744\u2747\u274c"
    "\u274e\u2753-\u2755\u2757\u2763\u2764\u2795-\u2797"
    "\u27a1\u27b0\u27bf\u2934\u2935]+",
    flags=re.UNICODE
)

def _clean_for_tts(text: str) -> str:
    """Strip all emojis, markdown symbols, timestamps, and URLs for clean TTS."""
    # Remove ALL non-ASCII unicode symbols (emojis, special chars)
    text = re.sub(r'[^\x00-\x7F\u0C00-\u0C7F\u0900-\u097F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C80-\u0CFF]', '', text)
    # Remove markdown
    text = re.sub(r'[*_`#~|>]', '', text)
    # Remove URLs
    text = re.sub(r'https?://\S+', '', text)
    # Remove timestamps like 22:16:43
    text = re.sub(r'\d{2}:\d{2}:\d{2}', '', text)
    # Remove date formats like 02 May 2026
    text = re.sub(r'\d{2} \w+ \d{4}', '', text)
    # Remove leftover dashes and punctuation artifacts
    text = re.sub(r'[\u2014\u2013\-]{2,}', '', text)
    # Clean up whitespace/newlines
    text = re.sub(r'[\n\r]+', '. ', text)
    text = re.sub(r'\s{2,}', ' ', text).strip()
    # Remove leading/trailing punctuation artifacts
    text = text.strip('.,- ')
    return text[:400]  # cap length for TTS

TELEGRAM_TOKEN   = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = int(os.getenv("TELEGRAM_CHAT_ID", "0"))

# ── Language persistence ──────────────────────────────────────────
_LANG_FILE = os.path.join(os.path.dirname(__file__), ".bot_lang")

def _load_lang() -> str:
    try:
        with open(_LANG_FILE) as f:
            return f.read().strip() or os.getenv("FAMILY_LANG", "te")
    except Exception:
        return os.getenv("FAMILY_LANG", "te")

def _save_lang(lang: str):
    try:
        with open(_LANG_FILE, "w") as f:
            f.write(lang)
    except Exception:
        pass

FAMILY_LANG = _load_lang()

LANG_NAMES = {"en": "English", "te": "Telugu (తెలుగు)", "hi": "Hindi (हिंदी)", "kn": "Kannada (ಕನ್ನಡ)", "ta": "Tamil (தமிழ்)"}

# Native-language confirmation messages
LANG_CONFIRM = {
    "en": "✅ Language set to *English*\nAll alerts and voice notes will now be in English.",
    "te": "✅ భాష *తెలుగు*కు మార్చబడింది\nభవిష్యత్తులో అన్ని హెచ్చరికలు తెలుగులో వస్తాయి.",
    "hi": "✅ भाषा *हिंदी* में बदल दी गई\nसभी अलर्ट और वॉयस नोट्स अब हिंदी में होंगे।",
    "kn": "✅ ಭಾಷೆ *ಕನ್ನಡ*ಕ್ಕೆ ಬದಲಾಯಿಸಲಾಗಿದೆ\nಮುಂದಿನ ಎಲ್ಲ ಎಚ್ಚರಿಕೆಗಳು ಕನ್ನಡದಲ್ಲಿ ಬರುತ್ತವೆ.",
    "ta": "✅ மொழி *தமிழ்*ஆக மாற்றப்பட்டது\nவருங்கால எச்சரிக்கைகள் தமிழில் இருக்கும்.",
}

_alert_cooldowns: dict[str, float] = {}
ALERT_COOLDOWN_SEC = 300  # 5 min per alert-type per patient

# Global per-patient cooldown: max 1 alert per patient per N seconds (any type)
_patient_cooldowns: dict[str, float] = {}
PATIENT_COOLDOWN_SEC = 60  # 1 message per patient per minute, regardless of type

_bot: Optional[Bot] = None
_engine_ref = None
_cam_url: str = os.getenv("ESP32_CAM_URL", "")  # e.g. http://192.168.1.x:81/stream
_ai_agent_ref = None   # AyuAgent reference for /risk, /ask, /brief

def set_engine(engine):
    global _engine_ref
    _engine_ref = engine

def set_cam_url(url: str):
    global _cam_url
    _cam_url = url

def set_ai_agent(agent):
    global _ai_agent_ref
    _ai_agent_ref = agent

def _can_alert(key: str) -> bool:
    """Per alert-type+patient cooldown check."""
    now = time.time()
    if key in _alert_cooldowns and (now - _alert_cooldowns[key]) < ALERT_COOLDOWN_SEC:
        return False
    _alert_cooldowns[key] = now
    return True

def _can_alert_patient(patient_name: str) -> bool:
    """Global per-patient cooldown — prevents any alert spam regardless of type."""
    now = time.time()
    if patient_name in _patient_cooldowns and (now - _patient_cooldowns[patient_name]) < PATIENT_COOLDOWN_SEC:
        return False
    _patient_cooldowns[patient_name] = now
    return True


# ─────────────────────────────────────────────────────────────────
#  MULTILINGUAL + INLINE BUTTON ALERT SENDER
# ─────────────────────────────────────────────────────────────────

async def send_alert(alert_type: str, message: str, patient_name: str = "",
                     value: str = "", village: str = "Hanamkonda",
                     lat: float = 17.9784, lng: float = 79.5941):
    global _bot
    if _bot is None:
        return
    key = f"{alert_type}:{patient_name}"
    if not _can_alert(key):
        return
    # Also check the global per-patient throttle to prevent spam
    if not _can_alert_patient(patient_name):
        return

    global FAMILY_LANG
    from ai_agent import MULTILINGUAL_ALERTS
    lang = FAMILY_LANG

    # Try multilingual template first
    tmpl = MULTILINGUAL_ALERTS.get(alert_type, {}).get(lang)
    if tmpl:
        text = tmpl.format(name=patient_name, village=village, value=value)
        text += f"\n\n⏰ `{time.strftime('%H:%M:%S, %d %b %Y')}`"
    else:
        # Fallback for alert types without a template
        emoji_map = {
            "sos": "🚨", "fall": "⚠️", "hr_high": "💔", "hr_low": "🫀",
            "spo2_low": "🫁", "temp_high": "🌡️", "bp_high": "🩺",
            "flame_detected": "🔥", "air_quality": "💨", "device_offline": "📡",
        }
        emoji = emoji_map.get(alert_type, "⚠️")
        severity_tag = "🔴 EMERGENCY" if alert_type in ("sos", "fall", "flame_detected") else "🟡 WARNING"
        text = (
            f"{emoji} *{severity_tag}*\n"
            f"👤 {patient_name or 'Unknown'}\n"
            f"🔔 {message}\n"
        )
        if value:
            text += f"📊 {value}\n"
        text += f"⏰ `{time.strftime('%H:%M:%S')}`"

    # Add inline buttons for emergencies
    markup = None
    if alert_type in ("sos", "fall", "flame_detected"):
        maps_url = f"https://maps.google.com/?q={lat},{lng}"
        markup = InlineKeyboardMarkup([
            [InlineKeyboardButton("🚑 CALL 108", callback_data="call_108"),
             InlineKeyboardButton("📍 Location", url=maps_url)],
            [InlineKeyboardButton("📊 Vitals", callback_data="action_vitals"),
             InlineKeyboardButton("🤖 ML Risk", callback_data="action_risk")],
            [InlineKeyboardButton("📷 Camera", callback_data="get_pic")]
        ])
    else:
        # Non-emergency abnormal alerts (e.g., High HR) get quick action buttons too
        markup = InlineKeyboardMarkup([
            [InlineKeyboardButton("📊 Check Vitals", callback_data="action_vitals"),
             InlineKeyboardButton("🤖 ML Risk Score", callback_data="action_risk")],
            [InlineKeyboardButton("📷 Camera Snapshot", callback_data="get_pic")]
        ])

    try:
        await _bot.send_message(
            chat_id=TELEGRAM_CHAT_ID,
            text=text,
            parse_mode="Markdown",
            reply_markup=markup
        )
        logger.info(f"[Telegram] Alert sent: {alert_type} for {patient_name}")
        
        # Send Voice Alert for ALL alerts — clean text first
        spoken_text = _clean_for_tts(text)
        if spoken_text:
            await send_voice_alert(spoken_text, lang)
            
    except TelegramError as e:
        logger.error(f"[Telegram] Alert failed: {e}")


# ─────────────────────────────────────────────────────────────────
#  VOICE ALERT SENDER (gTTS)
# ─────────────────────────────────────────────────────────────────

async def send_voice_alert(text: str, lang: str = "te"):
    """Convert text to speech and send as a Telegram voice note."""
    global _bot
    if _bot is None:
        return
    try:
        # Run gTTS in a thread to prevent blocking the async loop
        # gTTS needs internet - use explicit timeout via requests session
        def _generate_audio():
            import requests
            session = requests.Session()
            session.request = lambda method, url, **kwargs: requests.Session.request(
                session, method, url, timeout=15, **kwargs
            )
            tts = gTTS(text=text[:500], lang=lang)  # cap at 500 chars
            buf = io.BytesIO()
            tts.write_to_fp(buf)
            buf.seek(0)
            return buf
            
        buf = await asyncio.wait_for(asyncio.to_thread(_generate_audio), timeout=20)
        await _bot.send_voice(chat_id=TELEGRAM_CHAT_ID, voice=buf)
        logger.info(f"[Telegram] Voice alert sent (lang: {lang})")
    except asyncio.TimeoutError:
        logger.warning("[Telegram] Voice alert skipped — gTTS timeout (no internet?)")
    except Exception as e:
        logger.warning(f"[Telegram] Voice alert skipped: {e}")


# ─────────────────────────────────────────────────────────────────
#  ESP32-CAM SNAPSHOT
# ─────────────────────────────────────────────────────────────────

async def send_cam_snapshot(chat_id: int, context: ContextTypes.DEFAULT_TYPE, caption: str = ""):
    import httpx
    import main

    default_caption = caption or f"📷 AyuLink Camera\n⏰ {time.strftime('%H:%M:%S, %d %b %Y')}"

    # ── Attempt 1: proxy cache (instant, populated by backend frame loop) ──
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get("http://localhost:8000/api/snapshot")
            if resp.status_code == 200 and len(resp.content) > 1000:
                await context.bot.send_photo(chat_id=chat_id, photo=resp.content, caption=default_caption)
                logger.info("[Telegram] Snapshot sent via proxy cache.")
                return
    except Exception as e:
        logger.warning(f"[Telegram] Proxy cache miss: {e}")

    # ── Resolve cam URL: local var → backend API → .cam_url file ──
    cam_url = main.esp32_cam_url or _cam_url
    if not cam_url:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get("http://localhost:8000/api/camera")
                cam_url = r.json().get("url", "")
        except Exception:
            pass

    if not cam_url:
        await context.bot.send_message(
            chat_id=chat_id,
            text="❌ No ESP32-CAM URL configured.\nUse `/setcam http://IP:81/stream` to set it.",
            parse_mode="Markdown"
        )
        return

    # ── Build candidate capture URLs to try ──
    base = cam_url.split("/stream")[0].split("/mjpeg")[0]
    # ESP32-CAM: stream on :81, capture on :80 or same port
    candidates = [
        base + "/capture",                            # same port /capture
        base.replace(":81", ":80") + "/capture",      # port 80 /capture
        base.replace(":81", "") + "/capture",          # no port /capture
    ]

    for capture_url in candidates:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp2 = await client.get(capture_url)
                if resp2.status_code == 200 and len(resp2.content) > 1000:
                    await context.bot.send_photo(
                        chat_id=chat_id,
                        photo=resp2.content,
                        caption=default_caption
                    )
                    logger.info(f"[Telegram] Snapshot sent via {capture_url}")
                    return
        except Exception as e2:
            logger.debug(f"[Telegram] Capture attempt {capture_url} failed: {e2}")

    # ── All attempts failed ──
    await context.bot.send_message(
        chat_id=chat_id,
        text=(
            f"❌ Camera snapshot failed.\n"
            f"📡 Stream URL: `{cam_url}`\n\n"
            f"*Troubleshoot:*\n"
            f"• ESP32-CAM powered on?\n"
            f"• Browser may be holding the only stream connection\n"
            f"• Try closing the dashboard camera view first\n"
            f"• Or use `/setcam` to confirm the URL"
        ),
        parse_mode="Markdown"
    )



# ─────────────────────────────────────────────────────────────────
#  COMMAND HANDLERS
# ─────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    menu_text = (
        "🏥 *AyuLink IoT Health Monitor*\n\n"
        "📋 *Commands:*\n"
        "/vitals — Live vitals\n"
        "/risk — ML Risk score (0-100)\n"
        "/trend — Vital trend table\n"
        "/slots — Pill dispenser status\n"
        "/pic — ESP32-CAM snapshot\n"
        "/brief — AI health summary\n"
        "/ask `<q>` — Ask AI anything\n"
        "/status — System status\n"
        "/language — Change alert language\n\n"
        "🔔 *Auto-alerts:* SOS, Fall, Fire, Abnormal vitals\n"
        f"🌐 *Lang:* `{FAMILY_LANG.upper()}`"
    )
    keyboard = [
        [InlineKeyboardButton("📊 Live Vitals", callback_data="action_vitals"),
         InlineKeyboardButton("🤖 ML Risk Score", callback_data="action_risk")],
        [InlineKeyboardButton("📷 Camera", callback_data="get_pic"),
         InlineKeyboardButton("📈 Trend", callback_data="action_trend")],
        [InlineKeyboardButton("🌐 Change Language", callback_data="action_language")]
    ]
    await update.message.reply_text(menu_text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))

async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await cmd_start(update, context)

async def cmd_language(update: Update, context: ContextTypes.DEFAULT_TYPE):
    current = LANG_NAMES.get(FAMILY_LANG, FAMILY_LANG)
    keyboard = [
        [InlineKeyboardButton(f"{'✅ ' if FAMILY_LANG=='en' else ''}English 🇬🇧", callback_data="lang_en"),
         InlineKeyboardButton(f"{'✅ ' if FAMILY_LANG=='te' else ''}తెలుగు 🇮🇳", callback_data="lang_te")],
        [InlineKeyboardButton(f"{'✅ ' if FAMILY_LANG=='hi' else ''}हिंदी 🇮🇳", callback_data="lang_hi"),
         InlineKeyboardButton(f"{'✅ ' if FAMILY_LANG=='kn' else ''}ಕನ್ನಡ 🇮🇳", callback_data="lang_kn")],
        [InlineKeyboardButton(f"{'✅ ' if FAMILY_LANG=='ta' else ''}தமிழ் 🇮🇳", callback_data="lang_ta")]
    ]
    await update.message.reply_text(
        f"🌐 *Alert Language Settings*\n"
        f"Current: *{current}*\n\n"
        f"Select your language — alerts, voice notes, and\n"
        f"emergency messages will all arrive in that language:",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )

# ─────────────────────────────────────────────────────────────────
#  HELPER: build vitals text (reusable for buttons + commands)
# ─────────────────────────────────────────────────────────────────

async def _get_vitals_text(patient_id: str = "108") -> str:
    """Return a compact vitals string for the first available patient."""
    global _engine_ref
    if _engine_ref is None:
        return "❌ Backend not ready."
    # Try to find a matching patient
    patient = None
    for pid, state in _engine_ref.patients.items():
        if pid == patient_id or pid.replace("P_", "").replace("0", "") == patient_id.replace("P_", "").replace("0", ""):
            patient = state
            break
    if not patient:
        patient = list(_engine_ref.patients.values())[0] if _engine_ref.patients else None
    
    if patient is None:
        return "❌ No patient data yet."
    status_emoji = {"normal": "✅", "warning": "🟡", "critical": "🔴", "offline": "⚫"}.get(patient.status, "❓")
    bp_str = f"{patient.bp_systolic}/{patient.bp_diastolic} mmHg" if patient.bp_systolic > 0 else "N/A"
    temp_str = f"{patient.temp:.1f}" if patient.temp else "—"
    return (
        f"🏥 *{patient.name}* | {status_emoji} {patient.status.upper()}\n"
        f"❤️ HR: `{patient.hr or '—'} bpm` | 🫁 SpO₂: `{patient.spo2 or '—'}%`\n"
        f"🌡️ Temp: `{temp_str}°C` | 🩸 BP: `{bp_str}`\n"
        f"⚠️ Risk: `{patient.risk_score}/100`\n"
        f"⏰ `{time.strftime('%H:%M:%S')}`"
    )


async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    global FAMILY_LANG
    query = update.callback_query
    await query.answer()
    
    data = query.data
    if data.startswith("lang_"):
        lang_code = data.split("_")[1]
        FAMILY_LANG = lang_code
        _save_lang(lang_code)
        confirm = LANG_CONFIRM.get(lang_code, f"✅ Language set to *{LANG_NAMES.get(lang_code, lang_code)}*")
        await query.edit_message_text(confirm, parse_mode="Markdown")
        # Send voice confirmation in new language
        await send_voice_alert(f"Language changed to {LANG_NAMES.get(lang_code, lang_code)}", lang=lang_code)
        logger.info(f"[Telegram] Language changed to {lang_code}")
    elif data == "get_pic":
        await send_cam_snapshot(query.message.chat_id, context)
    elif data == "call_108":
        await query.message.reply_text(
            "🚨 *EMERGENCY — Call 108 Now!*\n\nDial: *108* (Free ambulance service)\nToll-free, 24/7 nationwide.",
            parse_mode="Markdown"
        )
    elif data == "action_vitals":
        context.args = []
        await query.message.reply_text(await _get_vitals_text())
    elif data == "action_risk":
        context.args = []
        from ai_agent import compute_risk_score
        risk = compute_risk_score("108")
        score = risk["score"]
        lvl = {"low":"🟢","moderate":"🟡","high":"🟠","critical":"🔴"}.get(risk["level"],"⚪")
        await query.message.reply_text(
            f"🤖 *ML Risk Score*\n{lvl} *{score}/100* ({risk['level'].upper()})\n📋 _{risk['reason']}_",
            parse_mode="Markdown"
        )
    elif data == "action_trend":
        from ai_agent import get_vital_history
        history = get_vital_history("108", limit=5)
        if not history:
            await query.message.reply_text("❌ No vital history yet.")
        else:
            rows = "".join(f"`{i}.` HR:{v['hr']} SpO₂:{v['spo2']}% T:{v['temp']}°\n" for i,v in enumerate(history,1))
            await query.message.reply_text(f"📊 *Vital Trend*\n{rows}", parse_mode="Markdown")
    elif data == "action_language":
        current = LANG_NAMES.get(FAMILY_LANG, FAMILY_LANG)
        keyboard = [
            [InlineKeyboardButton(f"{'✅ ' if FAMILY_LANG=='en' else ''}English 🇬🇧", callback_data="lang_en"),
             InlineKeyboardButton(f"{'✅ ' if FAMILY_LANG=='te' else ''}తెలుగు 🇮🇳", callback_data="lang_te")],
            [InlineKeyboardButton(f"{'✅ ' if FAMILY_LANG=='hi' else ''}हिंदी 🇮🇳", callback_data="lang_hi"),
             InlineKeyboardButton(f"{'✅ ' if FAMILY_LANG=='kn' else ''}ಕನ್ನಡ 🇮🇳", callback_data="lang_kn")],
            [InlineKeyboardButton(f"{'✅ ' if FAMILY_LANG=='ta' else ''}தமிழ் 🇮🇳", callback_data="lang_ta")]
        ]
        await query.message.reply_text(
            f"🌐 *Select Alert Language*\nCurrent: *{current}*",
            reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown"
        )

async def cmd_vitals(update: Update, context: ContextTypes.DEFAULT_TYPE):
    global _engine_ref
    patient_id = "108"
    if context.args:
        patient_id = context.args[0].upper()
    if _engine_ref is None:
        await update.message.reply_text("❌ Backend not ready.")
        return
    patient = None
    for pid, state in _engine_ref.patients.items():
        if pid == patient_id or pid.replace("P_", "").replace("0", "") == patient_id.replace("P_", "").replace("0", ""):
            patient = state
            break
    if patient is None:
        ids = list(_engine_ref.patients.keys())
        await update.message.reply_text(f"❌ Patient `{patient_id}` not found.\nAvailable: {', '.join(ids) or 'None'}", parse_mode="Markdown")
        return
    status_emoji = {"normal": "✅", "warning": "🟡", "critical": "🔴", "offline": "⚫"}.get(patient.status, "❓")
    worn_str = "✅ Device worn" if patient.worn else "⚠️ Not worn"
    last_seen = "Never" if patient.last_seen == 0 else f"{int(time.time() - patient.last_seen)}s ago"
    bp_str = f"{patient.bp_systolic}/{patient.bp_diastolic} mmHg" if patient.bp_systolic > 0 else "N/A"
    temp_str = f"{patient.temp:.1f}" if patient.temp else "—"
    text = (
        f"🏥 *AyuLink Vitals Report*\n━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 *{patient.name}* (ID: `{patient.id}`)\n"
        f"📍 {patient.village} | Age {patient.age}\n"
        f"🩺 {', '.join(patient.conditions) or 'None'}\n\n"
        f"{status_emoji} *Status: {patient.status.upper()}*\n"
        f"⚠️ Risk Score: `{patient.risk_score}/100`\n\n"
        f"❤️  HR: `{patient.hr or '—'} bpm`\n"
        f"🫁 SpO₂: `{patient.spo2 or '—'}%`\n"
        f"🌡️  Temp: `{temp_str}°C`\n"
        f"🩸 BP: `{bp_str}`\n\n"
        f"📡 {worn_str} | 🕐 {last_seen}\n"
        f"🌐 Alerts in: `{LANG_NAMES.get(FAMILY_LANG, FAMILY_LANG)}`\n"
        f"⏰ `{time.strftime('%H:%M:%S, %d %b %Y')}`"
    )
    keyboard = [[InlineKeyboardButton("🌐 Change Language", callback_data="action_language")]]
    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard))

async def cmd_slots(update: Update, context: ContextTypes.DEFAULT_TYPE):
    global _engine_ref
    if _engine_ref is None:
        await update.message.reply_text("❌ Backend not ready.")
        return
    hub = _engine_ref.hub_state
    online_str = "✅ Online" if hub.online else "⚫ Offline"
    flame_str = "🔥 *FIRE DETECTED!*" if hub.flame else "✅ Clear"
    slot_icons = ["Morning ☀️", "Afternoon 🌤", "Evening 🌆", "Night 🌙"]
    slots = [hub.pill_slot1, hub.pill_slot2, hub.pill_slot3, hub.pill_slot4]
    taken = sum(1 for s in slots if s)
    compliance = int((taken / 4) * 100)
    slots_text = ""
    for label, taken_status in zip(slot_icons, slots):
        slots_text += f"{'✅' if taken_status else '⬜'} {label}: {'Taken' if taken_status else 'Pending'}\n"
    aqi_emoji = "🔴" if (hub.air_ppm or 0) > 300 else "🟡" if (hub.air_ppm or 0) > 150 else "✅"
    text = (
        f"💊 *AyuLink Pill Dispenser*\n━━━━━━━━━━━━━━━━━━━━\n"
        f"📡 {online_str} | ⏰ `{hub.rtc_time or 'N/A'}`\n\n"
        f"*Today's Schedule:*\n{slots_text}\n"
        f"📊 Compliance: `{compliance}%` ({taken}/4 doses)\n\n"
        f"🌡️ Room: `{hub.env_temp:.1f}°C` | 💧 `{hub.humidity:.1f}%`\n"
        f"{aqi_emoji} Air: `{hub.air_ppm} PPM` ({hub.air_aqi})\n"
        f"🔥 Flame: {flame_str}\n"
        f"⏰ `{time.strftime('%H:%M:%S, %d %b %Y')}`"
    )
    await update.message.reply_text(text, parse_mode="Markdown")

async def cmd_pic(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("📷 Fetching snapshot...")
    await send_cam_snapshot(update.message.chat_id, context)

async def cmd_setcam(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Set the ESP32-CAM stream URL."""
    global _cam_url
    if not context.args:
        current = _cam_url or "Not set"
        await update.message.reply_text(
            f"📷 *ESP32-CAM URL*\nCurrent: `{current}`\n\nUsage: `/setcam http://192.168.x.x:81/stream`",
            parse_mode="Markdown"
        )
        return
    _cam_url = context.args[0].strip()
    
    # Save to file so it survives restarts
    import os
    cam_file = os.path.join(os.path.dirname(__file__), ".cam_url")
    try:
        with open(cam_file, "w") as f:
            f.write(_cam_url)
    except Exception as e:
        logger.error(f"[Telegram] Failed to save cam url: {e}")

    # Dynamically update the backend proxy loop so it starts fetching immediately
    import main
    main.esp32_cam_url = _cam_url

    await update.message.reply_text(
        f"✅ Camera URL set to:\n`{_cam_url}`\nTap /pic to test it.",
        parse_mode="Markdown"
    )

async def cmd_risk(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/risk — AI predictive risk score from vital trends."""
    from ai_agent import compute_risk_score
    patient_id = "108"
    if context.args:
        patient_id = context.args[0].upper()

    risk = compute_risk_score(patient_id)
    score = risk["score"]

    level_emoji = {"low": "🟢", "moderate": "🟡", "high": "🟠", "critical": "🔴"}.get(risk["level"], "⚪")
    action = ""
    if score >= 75:
        action = "\n⚠️ *Recommend calling patient immediately!*"
    elif score >= 50:
        action = "\n💬 Consider checking in with a call."
    else:
        action = "\n✅ No immediate action needed."

    try:
        temp_str = f"{float(risk['last_temp']):.1f}" if risk.get('last_temp') else "—"
    except (ValueError, TypeError):
        temp_str = str(risk.get('last_temp', '—'))

    text = (
        f"🤖 *AyuLink AI Risk Assessment*\n━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 Patient ID: `{patient_id}`\n\n"
        f"{level_emoji} *Risk Score: {score}/100* ({risk['level'].upper()})\n\n"
        f"📈 HR Trend: `{risk['trend_hr']}` ({risk.get('last_hr','—')} bpm)\n"
        f"📉 SpO₂ Trend: `{risk['trend_spo2']}` ({risk.get('last_spo2','—')}%)\n"
        f"🌡️ Temp: `{temp_str}°C`\n\n"
        f"📋 Reason: _{risk['reason']}_"
        f"{action}\n\n"
        f"⏰ `{time.strftime('%H:%M:%S, %d %b %Y')}`"
    )
    await update.message.reply_text(text, parse_mode="Markdown")



async def cmd_trend(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/trend — Show last 5 vital readings as a trend table."""
    from ai_agent import get_vital_history
    patient_id = "108"
    if context.args:
        patient_id = context.args[0].upper()

    history = get_vital_history(patient_id, limit=5)
    if not history:
        await update.message.reply_text("❌ No vital history yet. Waiting for hardware data.")
        return

    rows = ""
    for i, v in enumerate(history, 1):
        age_sec = int(time.time() - v["ts"])
        rows += f"`{i}.` HR:{v['hr']}  SpO₂:{v['spo2']}%  T:{v['temp']}°  ({age_sec}s ago)\n"

    hrs = [v["hr"] for v in history]
    spo2s = [v["spo2"] for v in history]
    hr_arrow = "📈" if hrs[-1] > hrs[0] else "📉" if hrs[-1] < hrs[0] else "➡️"
    spo2_arrow = "📈" if spo2s[-1] > spo2s[0] else "📉" if spo2s[-1] < spo2s[0] else "➡️"

    text = (
        f"📊 *Vital Trend — Last {len(history)} Readings*\n━━━━━━━━━━━━━━━━━━━━\n"
        f"{rows}\n"
        f"{hr_arrow} HR: {hrs[0]} → {hrs[-1]} bpm\n"
        f"{spo2_arrow} SpO₂: {spo2s[0]}% → {spo2s[-1]}%\n\n"
        f"Use /risk for AI analysis"
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def cmd_brief(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/brief — AI-generated health summary for today."""
    global _ai_agent_ref, _engine_ref
    if _ai_agent_ref is None or _engine_ref is None:
        await update.message.reply_text("❌ AI agent not ready.")
        return

    await update.message.reply_text("🤖 Generating health summary...")

    # Get patient info
    patient = _engine_ref.patients.get("108") or _engine_ref.patients.get("P_01")
    if not patient:
        await update.message.reply_text("❌ No patient data available.")
        return

    summary = await _ai_agent_ref.generate_morning_brief(
        patient_name=patient.name,
        patient_id=patient.id,
        village=patient.village,
        conditions=patient.conditions,
    )

    from ai_agent import compute_risk_score
    risk = compute_risk_score(patient.id)
    level_emoji = {"low": "🟢", "moderate": "🟡", "high": "🟠", "critical": "🔴"}.get(risk["level"], "⚪")

    text = (
        f"📋 *AyuLink Health Brief*\n━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 {patient.name} | 📍 {patient.village}\n\n"
        f"🤖 *AI Assessment:*\n_{summary}_\n\n"
        f"{level_emoji} Current Risk: `{risk['score']}/100` ({risk['level']})\n"
        f"⏰ `{time.strftime('%H:%M:%S, %d %b %Y')}`"
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def cmd_ask(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/ask <question> — Ask the AI medical assistant anything."""
    global _ai_agent_ref, _engine_ref
    if not context.args:
        await update.message.reply_text("Usage: `/ask <your question>`\nExample: `/ask What does low SpO2 mean?`", parse_mode="Markdown")
        return
    if _ai_agent_ref is None:
        await update.message.reply_text("❌ AI not ready.")
        return

    question = " ".join(context.args)
    await update.message.reply_text("🤖 Thinking...")

    # Build patient context if available
    patient_ctx = ""
    if _engine_ref:
        p = _engine_ref.patients.get("108") or _engine_ref.patients.get("P_01")
        if p:
            patient_ctx = f"{p.name}, {p.age}yo, {', '.join(p.conditions)}, HR {p.hr}, SpO2 {p.spo2}%"

    answer = await _ai_agent_ref.answer_question(question, patient_context=patient_ctx)
    text = f"🤖 *AyuLink AI*\n\n_{answer}_\n\n⚠️ _Always consult a doctor for medical decisions._"
    await update.message.reply_text(text, parse_mode="Markdown")


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    global _engine_ref
    if _engine_ref is None:
        await update.message.reply_text("❌ Backend not ready.")
        return
    state = _engine_ref.get_dashboard_state()
    stats = state.get("stats", {})
    patients = state.get("patients", [])
    hub = _engine_ref.hub_state
    online_pts = sum(1 for p in patients if p["status"] != "offline")
    critical_pts = sum(1 for p in patients if p["status"] == "critical")
    uptime = stats.get("uptime", 0)
    uptime_str = f"{uptime // 3600}h {(uptime % 3600) // 60}m"
    text = (
        f"🖥️ *AyuLink System Status*\n━━━━━━━━━━━━━━━━━━━━\n"
        f"⏱️ Uptime: `{uptime_str}`\n"
        f"📦 Packets: `{stats.get('total_packets', 0):,}`\n"
        f"🚨 Alerts: `{stats.get('total_alerts', 0)}`\n\n"
        f"👥 Patients: {online_pts}/{len(patients)} online | 🔴 {critical_pts} critical\n"
        f"💊 Dispenser: {'✅ Online' if hub.online else '⚫ Offline'}\n"
        f"📡 Camera: {'✅ Set' if _cam_url else '⚫ Not set'}\n"
        f"🤖 AI: ✅ Active (Groq LLaMA)\n\n"
        f"⏰ `{time.strftime('%H:%M:%S, %d %b %Y')}`"
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def cmd_unknown(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("❓ Unknown command. Use /help for available commands.")


# ─────────────────────────────────────────────────────────────────
#  BOT LIFECYCLE
# ─────────────────────────────────────────────────────────────────

_app: Optional[Application] = None


async def start_bot(engine=None, cam_url: str = "", ai_agent=None) -> Optional[Application]:
    global _bot, _app, _engine_ref, _cam_url, _ai_agent_ref
    if engine:
        _engine_ref = engine
    if cam_url:
        _cam_url = cam_url
    if ai_agent:
        _ai_agent_ref = ai_agent

    try:
        app = (
            Application.builder()
            .token(TELEGRAM_TOKEN)
            .connect_timeout(30)
            .read_timeout(30)
            .write_timeout(30)
            .pool_timeout(30)
            .build()
        )
        app.add_handler(CommandHandler("start",  cmd_start))
        app.add_handler(CommandHandler("help",   cmd_help))
        app.add_handler(CommandHandler("language", cmd_language))
        app.add_handler(CommandHandler("lang",   cmd_language))  # alias
        app.add_handler(CommandHandler("vitals", cmd_vitals))
        app.add_handler(CallbackQueryHandler(handle_callback))
        app.add_handler(CommandHandler("slots",  cmd_slots))
        app.add_handler(CommandHandler("pic",    cmd_pic))
        app.add_handler(CommandHandler("setcam", cmd_setcam))
        app.add_handler(CommandHandler("risk",   cmd_risk))
        app.add_handler(CommandHandler("trend",  cmd_trend))
        app.add_handler(CommandHandler("brief",  cmd_brief))
        app.add_handler(CommandHandler("ask",    cmd_ask))
        app.add_handler(CommandHandler("status", cmd_status))
        app.add_handler(MessageHandler(filters.COMMAND, cmd_unknown))

        _bot = app.bot
        _app = app
        await app.initialize()
        await app.start()
        await app.updater.start_polling(drop_pending_updates=True)

        logger.info("[Telegram] ✓ Bot started")
        print(f"[Telegram] ✓ Bot active")

        try:
            await _bot.send_message(
                chat_id=TELEGRAM_CHAT_ID,
                text=(
                    "🏥 *AyuLink Bot Online!*\n\n"
                    "✨ New commands: /risk /trend /brief /ask\n"
                    "🌐 Emergency alerts: English + Telugu + Hindi\n"
                    "🚑 SOS alerts now include one-tap 108 button\n\n"
                    f"⏰ `{time.strftime('%H:%M:%S, %d %b %Y')}`"
                ),
                parse_mode="Markdown"
            )
        except Exception as e:
            logger.warning(f"[Telegram] Startup notify failed: {e}")

        return app
    except Exception as e:
        logger.error(f"[Telegram] Bot init failed: {e}")
        print(f"[Telegram] ❌ Failed: {e}")
        return None


async def stop_bot():
    global _app
    if _app:
        try:
            await _app.updater.stop()
            await _app.stop()
            await _app.shutdown()
        except Exception as e:
            logger.error(f"[Telegram] Stop error: {e}")
