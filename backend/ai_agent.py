"""
AyuLink AI Medical Agent — Groq-Powered Triage + Mental Health
Correlates vitals + environment + compliance + mental health distress.
Supports runtime API key swap, cooldown-based alert-only triggers.
DB-aware: reads patient registrations and vitals history for risk scoring.
"""
import asyncio, json, os, time, re
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Optional
from groq import AsyncGroq
from dotenv import load_dotenv

load_dotenv()

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
AI_COOLDOWN_SECONDS = 60
MAX_TOKENS = 200

# ── In-memory vital ring buffer for risk scoring ──────────────────
# patient_id → deque of {"hr","spo2","temp","ts"}
_vital_history: dict[str, deque] = defaultdict(lambda: deque(maxlen=20))

def record_vital(patient_id: str, hr: int, spo2: int, temp: float):
    """Called on every incoming vital reading to build the trend buffer."""
    _vital_history[patient_id].append({"hr": hr, "spo2": spo2, "temp": temp, "ts": time.time()})

def get_vital_history(patient_id: str, limit: int = 10) -> list[dict]:
    """Return last N vitals from the in-memory ring buffer (newest first)."""
    buf = list(_vital_history.get(patient_id, []))
    return list(reversed(buf[-limit:]))

def compute_risk_score(patient_id: str) -> dict:
    """
    Compute a 0-100 risk score from recent vital trends.
    Also pulls DB history as fallback when in-memory buffer is empty.
    """
    buf = list(_vital_history.get(patient_id, []))

    # Fallback: pull from DB if in-memory buffer is sparse
    if len(buf) < 3:
        try:
            import database as db_mod
            db_rows = db_mod.get_vitals_history(patient_id, limit=10)
            if db_rows:
                buf = [{"hr": r["hr"], "spo2": r["spo2"], "temp": r["temp"], "ts": r["timestamp"]} for r in db_rows]
        except Exception:
            pass

    if not buf:
        return {"score": 0, "level": "low", "reason": "No data yet", "trend_hr": "—", "trend_spo2": "—"}

    latest = buf[-1]
    hr, spo2, temp = latest["hr"], latest["spo2"], latest["temp"]
    score = 0
    reasons = []

    # SpO2 — most critical
    if spo2 < 90:
        score += 40; reasons.append(f"SpO2 critically low ({spo2}%)")
    elif spo2 < 94:
        score += 20; reasons.append(f"SpO2 low ({spo2}%)")

    # HR
    if hr > 130 or hr < 40:
        score += 30; reasons.append(f"HR critically abnormal ({hr}bpm)")
    elif hr > 100 or hr < 55:
        score += 15; reasons.append(f"HR abnormal ({hr}bpm)")

    # Temp
    if temp > 39.5 or temp < 35:
        score += 20; reasons.append(f"Temperature critical ({temp}°C)")
    elif temp > 38.5:
        score += 10; reasons.append(f"Fever ({temp}°C)")

    # Trend analysis (if enough data)
    trend_hr = trend_spo2 = "stable"
    if len(buf) >= 3:
        hrs  = [v["hr"]   for v in buf[-3:]]
        spo2s = [v["spo2"] for v in buf[-3:]]
        if hrs[-1]   > hrs[0]   + 10: trend_hr  = "rising ↑"
        elif hrs[-1] < hrs[0]   - 10: trend_hr  = "falling ↓"
        if spo2s[-1] < spo2s[0] - 3:  trend_spo2 = "dropping ↓"; score += 10

    score = min(score, 100)
    level = "critical" if score >= 70 else "high" if score >= 50 else "moderate" if score >= 30 else "low"
    reason = "; ".join(reasons) if reasons else "Vitals within normal range"

    return {
        "score": score,
        "level": level,
        "reason": reason,
        "trend_hr": trend_hr,
        "trend_spo2": trend_spo2,
        "last_hr": hr,
        "last_spo2": spo2,
        "last_temp": temp,
    }

# ── Multilingual alert templates ──────────────────────────────────
MULTILINGUAL_ALERTS: dict[str, dict[str, str]] = {
    "sos": {
        "en": "🚨 *SOS EMERGENCY*\n👤 {name} activated SOS!\n📍 {village}\n📊 {value}\n⏰ Immediate response needed!",
        "te": "🚨 *అత్యవసర పరిస్థితి* — {name} SOS నొక్కారు!\n📍 {village}\n⏰ వెంటనే స్పందించండి!",
        "hi": "🚨 *आपातकाल* — {name} ने SOS दबाया!\n📍 {village}\n⏰ तुरंत प्रतिक्रिया आवश्यक!",
    },
    "fall": {
        "en": "⚠️ *FALL DETECTED*\n👤 {name} has fallen!\n📍 {village}\n⏰ Immediate assistance needed!",
        "te": "⚠️ *పడిపోయారు* — {name} పడిపోయారు!\n📍 {village}\n⏰ వెంటనే సహాయం అవసరం!",
        "hi": "⚠️ *गिर गए* — {name} गिर गए!\n📍 {village}\n⏰ तत्काल सहायता आवश्यक!",
    },
    "hr_high": {
        "en": "💔 *HIGH HEART RATE*\n👤 {name} — HR: {value}\n📍 {village}\n⚠️ Cardiac alert!",
        "te": "💔 *గుండె వేగం ఎక్కువ* — {name} HR: {value}",
        "hi": "💔 *उच्च हृदय गति* — {name} HR: {value}",
    },
    "spo2_low": {
        "en": "🫁 *LOW OXYGEN*\n👤 {name} — SpO₂: {value}\n📍 {village}\n⚠️ Hypoxia risk!",
        "te": "🫁 *ఆక్సిజన్ తక్కువ* — {name} SpO₂: {value}",
        "hi": "🫁 *कम ऑक्सीजन* — {name} SpO₂: {value}",
    },
    "temp_high": {
        "en": "🌡️ *HIGH TEMPERATURE*\n👤 {name} — Temp: {value}\n📍 {village}",
        "te": "🌡️ *జ్వరం* — {name} Temp: {value}",
        "hi": "🌡️ *बुखार* — {name} Temp: {value}",
    },
    "flame_detected": {
        "en": "🔥 *FIRE DETECTED!*\n📍 {village} — Dispenser flame sensor triggered!\n⏰ Evacuate immediately!",
        "te": "🔥 *మంటలు కనుగొన్నారు!* — {village} వెంటనే బయటకు వెళ్ళండి!",
        "hi": "🔥 *आग लगी!* — {village} तुरंत बाहर निकलें!",
    },
    "air_quality": {
        "en": "💨 *BAD AIR QUALITY*\n📍 {village} — Air: {value} PPM\n⚠️ Ventilate the room.",
        "te": "💨 *గాలి నాణ్యత చెడ్డది* — {value} PPM",
        "hi": "💨 *खराब वायु गुणवत्ता* — {value} PPM",
    },
}

# Mental health distress keywords
DISTRESS_KEYWORDS = re.compile(
    r"\b(suicide|kill myself|end it|hopeless|worthless|can't go on|"
    r"nobody cares|give up|hurt myself|self.?harm|depressed|anxious|"
    r"panic|scared|lonely|crying|overwhelmed|stressed|despair)\b",
    re.IGNORECASE
)

HELPLINES = {
    "en": "iCall: 9152987821 | Vandrevala: 1860-2662-345 | KIRAN: 1800-599-0019",
    "hi": "iCall: 9152987821 | वंद्रेवाला: 1860-2662-345 | किरण: 1800-599-0019",
    "te": "iCall: 9152987821 | వంద్రేవాలా: 1860-2662-345 | కిరణ్: 1800-599-0019",
}


@dataclass
class AgentInsight:
    patient_id: str
    patient_name: str
    severity: str
    trigger: str
    headline: str
    detail: str
    action: str
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in
                ["patient_id","patient_name","severity","trigger","headline","detail","action","timestamp"]}


class AyuAgent:
    def __init__(self, api_key: str = ""):
        self.api_key = api_key or os.getenv("GROQ_API_KEY", "")
        if not self.api_key:
            raise ValueError("GROQ_API_KEY not set!")
        self.client = AsyncGroq(api_key=self.api_key)
        self._cooldowns: dict[str, float] = {}
        self.insights: list[AgentInsight] = []
        print(f"[AyuAgent] ✓ Groq initialized (model: {GROQ_MODEL})")

    def update_api_key(self, new_key: str):
        """Hot-swap API key at runtime."""
        self.api_key = new_key
        self.client = AsyncGroq(api_key=new_key)
        print(f"[AyuAgent] API key updated")

    def _on_cooldown(self, patient_id: str, trigger: str) -> bool:
        key = f"{patient_id}:{trigger}"
        now = time.time()
        if key in self._cooldowns and (now - self._cooldowns[key]) < AI_COOLDOWN_SECONDS:
            return True
        self._cooldowns[key] = now
        return False

    @staticmethod
    def detect_distress(text: str) -> bool:
        return bool(DISTRESS_KEYWORDS.search(text))

    def _get_patient_db_context(self, patient_id: str) -> str:
        """Pull rich patient context from SQLite for AI prompts."""
        try:
            import database as db_mod
            # Try the given ID and common variants
            p = db_mod.get_patient(patient_id)
            if not p:
                # Try all patients and match loosely
                for pt in db_mod.get_all_patients():
                    if pt["id"] == patient_id or patient_id in pt["id"]:
                        p = pt; break
            if not p:
                return ""
            conds = ", ".join(p.get("conditions", [])) or "None"
            allergies = ", ".join(p.get("allergies", [])) or "None"
            return (
                f"Patient: {p['name']}, Age {p.get('age',0)}, Village: {p.get('village','')}, "
                f"Conditions: {conds}, Allergies: {allergies}, Blood: {p.get('blood_group','Unknown')}, "
                f"Language: {p.get('language','Telugu')}"
            )
        except Exception:
            return ""

    async def mental_health_response(self, message: str, language: str = "en") -> dict:
        """Generate empathetic mental health first-aid response."""
        lang_map = {"en": "English", "hi": "Hindi", "te": "Telugu"}
        helpline = HELPLINES.get(language, HELPLINES["en"])
        prompt = (
            f"A user sent: \"{message}\"\n"
            "They may be in emotional distress. As a mental health first-aid bot:\n"
            "1. Acknowledge their feelings with empathy\n"
            "2. Provide 1-2 evidence-based coping techniques\n"
            "3. Gently encourage professional help\n"
            f"Include this helpline info: {helpline}\n"
            f"Respond in {lang_map.get(language, 'English')}. Keep under 4 sentences."
        )
        try:
            r = await self.client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "system", "content": "You are a compassionate mental health first-aid assistant. Never diagnose. Always recommend professional help. Be warm and non-judgmental."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=250, temperature=0.6,
            )
            return {"ok": True, "reply": r.choices[0].message.content, "is_distress": True, "helplines": helpline}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def analyze(self, *, patient_id: str, patient_name: str, age: int,
                      conditions: list[str], hr: int, spo2: int, temp: float,
                      pill_slot1: bool, pill_slot2: bool, pill_slot3: bool, pill_slot4: bool,
                      air_ppm: int, air_aqi: str, flame: bool,
                      sos: bool, fall: bool, trigger: str, severity: str) -> Optional[AgentInsight]:
        if self._on_cooldown(patient_id, trigger):
            return None

        # Enrich with DB patient record
        db_ctx = self._get_patient_db_context(patient_id)
        risk = compute_risk_score(patient_id)

        slots = [("Morning", pill_slot1), ("Afternoon", pill_slot2),
                 ("Evening", pill_slot3), ("Night", pill_slot4)]
        missed = [s[0] for s in slots if not s[1]]
        taken  = [s[0] for s in slots if s[1]]
        flags = []
        if sos:   flags.append("SOS activated")
        if fall:  flags.append("Fall detected")
        if flame: flags.append("FIRE detected")

        user_prompt = (
            f"PATIENT: {patient_name}, Age {age}, Conditions: {', '.join(conditions) or 'None'}\n"
            f"DB RECORD: {db_ctx}\n"
            f"TRIGGER: {trigger} ({severity.upper()}) | RISK: {risk['score']}/100 ({risk['level']})\n"
            f"FLAGS: {', '.join(flags) or 'None'}\n"
            f"VITALS: HR {hr}bpm, SpO2 {spo2}%, Temp {temp}°C\n"
            f"ENV: Air {air_ppm}PPM ({air_aqi}), Flame: {'YES' if flame else 'No'}\n"
            f"MEDS: Taken={', '.join(taken) or 'NONE'}, Missed={', '.join(missed) or 'None'}\n"
            "Respond ONLY JSON: {\"headline\":\"...\",\"detail\":\"...\",\"action\":\"...\"}"
        )

        try:
            r = await self.client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "system", "content": "You are AyuLink Medical Triage Agent for eldercare IoT. Correlate all signals. Respond in strict JSON with keys: headline, detail, action. Be precise and concise."},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=MAX_TOKENS, temperature=0.4,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(r.choices[0].message.content)
            insight = AgentInsight(
                patient_id=patient_id, patient_name=patient_name,
                severity=severity, trigger=trigger,
                headline=parsed.get("headline", "AI insight"),
                detail=parsed.get("detail", ""),
                action=parsed.get("action", ""),
            )
            self.insights.append(insight)
            if len(self.insights) > 50:
                self.insights = self.insights[-50:]
            return insight
        except Exception as e:
            print(f"[AyuAgent] Error: {e}")
            return None

    async def generate_morning_brief(self, patient_name: str, patient_id: str,
                                     village: str, conditions: list[str]) -> str:
        """Generate a short daily health summary for the patient."""
        risk = compute_risk_score(patient_id)
        db_ctx = self._get_patient_db_context(patient_id)
        history = get_vital_history(patient_id, limit=5)
        history_str = "; ".join(f"HR:{v['hr']} SpO2:{v['spo2']}% T:{v['temp']}°" for v in history) or "No recent data"
        prompt = (
            f"Generate a brief 3-sentence morning health summary for {patient_name} ({village}).\n"
            f"Conditions: {', '.join(conditions) or 'None'}. DB: {db_ctx}\n"
            f"Recent vitals: {history_str}\n"
            f"Risk score: {risk['score']}/100 ({risk['level']}). Reason: {risk['reason']}\n"
            "Be specific, actionable, and empathetic. Do NOT use markdown."
        )
        try:
            r = await self.client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "system", "content": "You are a rural eldercare health assistant. Give concise, practical daily health summaries."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=150, temperature=0.5,
            )
            return r.choices[0].message.content.strip()
        except Exception as e:
            return f"Unable to generate brief: {e}"

    async def answer_question(self, question: str, patient_context: str = "") -> str:
        """Answer a free-form medical question with patient context."""
        prompt = question
        if patient_context:
            prompt = f"Patient context: {patient_context}\n\nQuestion: {question}"
        try:
            r = await self.client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "system", "content": "You are AyuLink, a medical AI assistant for rural Indian eldercare. Answer concisely and practically. Always recommend consulting a doctor for serious concerns."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=200, temperature=0.5,
            )
            return r.choices[0].message.content.strip()
        except Exception as e:
            return f"AI error: {e}"

    def get_recent_insights(self, n: int = 20) -> list[dict]:
        return [i.to_dict() for i in reversed(self.insights[-n:])]

    def clear_insights(self):
        self.insights.clear()

import asyncio, json, os, time, re
from dataclasses import dataclass, field
from typing import Optional
from groq import AsyncGroq
from dotenv import load_dotenv

load_dotenv()

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
AI_COOLDOWN_SECONDS = 60  # increased to stop token spam
MAX_TOKENS = 200

# Mental health distress keywords
DISTRESS_KEYWORDS = re.compile(
    r"\b(suicide|kill myself|end it|hopeless|worthless|can't go on|"
    r"nobody cares|give up|hurt myself|self.?harm|depressed|anxious|"
    r"panic|scared|lonely|crying|overwhelmed|stressed|despair)\b",
    re.IGNORECASE
)

HELPLINES = {
    "en": "iCall: 9152987821 | Vandrevala: 1860-2662-345 | KIRAN: 1800-599-0019",
    "hi": "iCall: 9152987821 | वंद्रेवाला: 1860-2662-345 | किरण: 1800-599-0019",
    "te": "iCall: 9152987821 | వంద్రేవాలా: 1860-2662-345 | కిరణ్: 1800-599-0019",
}


@dataclass
class AgentInsight:
    patient_id: str
    patient_name: str
    severity: str
    trigger: str
    headline: str
    detail: str
    action: str
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in
                ["patient_id","patient_name","severity","trigger","headline","detail","action","timestamp"]}


class AyuAgent:
    def __init__(self, api_key: str = ""):
        self.api_key = api_key or os.getenv("GROQ_API_KEY", "")
        if not self.api_key:
            raise ValueError("GROQ_API_KEY not set!")
        self.client = AsyncGroq(api_key=self.api_key)
        self._cooldowns: dict[str, float] = {}
        self.insights: list[AgentInsight] = []
        print(f"[AyuAgent] ✓ Groq initialized (model: {GROQ_MODEL})")

    def update_api_key(self, new_key: str):
        """Hot-swap API key at runtime."""
        self.api_key = new_key
        self.client = AsyncGroq(api_key=new_key)
        print(f"[AyuAgent] API key updated")

    def _on_cooldown(self, patient_id: str, trigger: str) -> bool:
        key = f"{patient_id}:{trigger}"
        now = time.time()
        if key in self._cooldowns and (now - self._cooldowns[key]) < AI_COOLDOWN_SECONDS:
            return True
        self._cooldowns[key] = now
        return False

    @staticmethod
    def detect_distress(text: str) -> bool:
        return bool(DISTRESS_KEYWORDS.search(text))

    async def mental_health_response(self, message: str, language: str = "en") -> dict:
        """Generate empathetic mental health first-aid response."""
        lang_map = {"en": "English", "hi": "Hindi", "te": "Telugu"}
        helpline = HELPLINES.get(language, HELPLINES["en"])

        prompt = (
            f"A user sent: \"{message}\"\n"
            "They may be in emotional distress. As a mental health first-aid bot:\n"
            "1. Acknowledge their feelings with empathy\n"
            "2. Provide 1-2 evidence-based coping techniques\n"
            "3. Gently encourage professional help\n"
            f"Include this helpline info: {helpline}\n"
            f"Respond in {lang_map.get(language, 'English')}. Keep under 4 sentences."
        )
        try:
            r = await self.client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "system", "content": "You are a compassionate mental health first-aid assistant. Never diagnose. Always recommend professional help. Be warm and non-judgmental."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=250, temperature=0.6,
            )
            return {"ok": True, "reply": r.choices[0].message.content, "is_distress": True, "helplines": helpline}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def analyze(self, *, patient_id: str, patient_name: str, age: int,
                      conditions: list[str], hr: int, spo2: int, temp: float,
                      pill_slot1: bool, pill_slot2: bool, pill_slot3: bool, pill_slot4: bool,
                      air_ppm: int, air_aqi: str, flame: bool,
                      sos: bool, fall: bool, trigger: str, severity: str) -> Optional[AgentInsight]:
        if self._on_cooldown(patient_id, trigger):
            return None

        slots = [("Morning", pill_slot1), ("Afternoon", pill_slot2),
                 ("Evening", pill_slot3), ("Night", pill_slot4)]
        missed = [s[0] for s in slots if not s[1]]
        taken = [s[0] for s in slots if s[1]]

        flags = []
        if sos: flags.append("SOS activated")
        if fall: flags.append("Fall detected")
        if flame: flags.append("FIRE detected")

        user_prompt = (
            f"PATIENT: {patient_name}, Age {age}, Conditions: {', '.join(conditions) or 'None'}\n"
            f"TRIGGER: {trigger} ({severity.upper()})\n"
            f"FLAGS: {', '.join(flags) or 'None'}\n"
            f"VITALS: HR {hr}bpm, SpO2 {spo2}%, Temp {temp}°C\n"
            f"ENV: Air {air_ppm}PPM ({air_aqi}), Flame: {'YES' if flame else 'No'}\n"
            f"MEDS: Taken={', '.join(taken) or 'NONE'}, Missed={', '.join(missed) or 'None'}\n"
            "Respond ONLY JSON: {\"headline\":\"...\",\"detail\":\"...\",\"action\":\"...\"}"
        )

        try:
            r = await self.client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "system", "content": "You are AyuLink Medical Triage Agent for eldercare IoT. Correlate all signals. Respond in strict JSON with keys: headline, detail, action. Be precise and concise."},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=MAX_TOKENS, temperature=0.4,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(r.choices[0].message.content)
            insight = AgentInsight(
                patient_id=patient_id, patient_name=patient_name,
                severity=severity, trigger=trigger,
                headline=parsed.get("headline", "AI insight"),
                detail=parsed.get("detail", ""),
                action=parsed.get("action", ""),
            )
            self.insights.append(insight)
            if len(self.insights) > 50:
                self.insights = self.insights[-50:]
            return insight
        except Exception as e:
            print(f"[AyuAgent] Error: {e}")
            return None

    def get_recent_insights(self, n: int = 20) -> list[dict]:
        return [i.to_dict() for i in reversed(self.insights[-n:])]

    def clear_insights(self):
        self.insights.clear()

    def _get_patient_db_context(self, patient_id: str) -> str:
        """Pull rich patient context from SQLite for AI prompts."""
        try:
            import database as db_mod
            p = db_mod.get_patient(patient_id)
            if not p:
                for pt in db_mod.get_all_patients():
                    if pt["id"] == patient_id or patient_id in pt["id"]:
                        p = pt; break
            if not p:
                return ""
            conds = ", ".join(p.get("conditions", [])) or "None"
            allergies = ", ".join(p.get("allergies", [])) or "None"
            return (
                f"Patient: {p['name']}, Age {p.get('age',0)}, Village: {p.get('village','')}, "
                f"Conditions: {conds}, Allergies: {allergies}, Blood: {p.get('blood_group','Unknown')}, "
                f"Language: {p.get('language','Telugu')}"
            )
        except Exception:
            return ""

    async def generate_morning_brief(self, patient_name: str, patient_id: str,
                                     village: str, conditions: list) -> str:
        """Generate a short daily health summary for the patient."""
        risk = compute_risk_score(patient_id)
        db_ctx = self._get_patient_db_context(patient_id)
        history = get_vital_history(patient_id, limit=5)
        history_str = "; ".join(f"HR:{v['hr']} SpO2:{v['spo2']}% T:{v['temp']}°" for v in history) or "No recent data"
        prompt = (
            f"Generate a brief 3-sentence morning health summary for {patient_name} ({village}).\n"
            f"Conditions: {', '.join(conditions) or 'None'}. DB: {db_ctx}\n"
            f"Recent vitals: {history_str}\n"
            f"Risk score: {risk['score']}/100 ({risk['level']}). Reason: {risk['reason']}\n"
            "Be specific, actionable, and empathetic. Do NOT use markdown."
        )
        try:
            r = await self.client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "system", "content": "You are a rural eldercare health assistant. Give concise, practical daily health summaries."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=150, temperature=0.5,
            )
            return r.choices[0].message.content.strip()
        except Exception as e:
            return f"Unable to generate brief: {e}"

    async def answer_question(self, question: str, patient_context: str = "") -> str:
        """Answer a free-form medical question with patient context."""
        prompt = f"Patient context: {patient_context}\n\nQuestion: {question}" if patient_context else question
        try:
            r = await self.client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "system", "content": "You are AyuLink, a medical AI assistant for rural Indian eldercare. Answer concisely and practically. Always recommend consulting a doctor for serious concerns."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=200, temperature=0.5,
            )
            return r.choices[0].message.content.strip()
        except Exception as e:
            return f"AI error: {e}"
