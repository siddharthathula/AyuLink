"""
AyuLink AI Medical Agent — Local-First LLM Triage + Mental Health
Correlates vitals + environment + compliance + mental health distress.
Supports runtime API key swap, cooldown-based alert-only triggers.
DB-aware: reads patient registrations and vitals history for risk scoring.

Provider: local Ollama (default, offline) with automatic Groq fallback.
"""
import asyncio, json, os, time, re, socket
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Optional
from groq import AsyncGroq
from dotenv import load_dotenv

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
AI_PROVIDER = os.getenv("AI_PROVIDER", "auto")        # auto | ollama | groq
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
AI_COOLDOWN_SECONDS = 60
MAX_TOKENS = 300

MED_PALM_SYSTEM_PROMPT = (
    "You are AyuLink Med-PaLM, an AI Clinical Triage System inspired by Google Med-PaLM 2 and clinical decision support standards. "
    "Your objective is to provide expert-level medical triage, pathophysiological correlation, and actionable clinical advice for rural eldercare. "
    "Always correlate vital signs (HR, SpO2, Temp), environmental telemetry (MQ-135 Air PPM, Ambient Temp, Flame), and medication adherence. "
    "Provide clear, precise, empathetic advice tailored to rural Indian healthcare (ASHA workers, PHC doctors, and family caregivers)."
)

def _ollama_reachable(timeout: float = 0.6) -> bool:
    """Quick check whether a local Ollama server is up (offline-first)."""
    try:
        import urllib.request
        with urllib.request.urlopen(OLLAMA_BASE_URL.replace("/v1", "/api/tags"),
                                    timeout=timeout):
            return True
    except Exception:
        return False


# ── Minimal OpenAI-compatible client for local Ollama ──────────────
# (the Groq SDK 1.x rewrites the URL path and 404s against Ollama)
class _OllamaMsg:
    def __init__(self, m: dict):
        self.content = m.get("content", "")

class _OllamaChoice:
    def __init__(self, c: dict):
        self.message = _OllamaMsg(c.get("message", {}))

class _OllamaResp:
    def __init__(self, data: dict):
        self.choices = [_OllamaChoice(c) for c in data.get("choices", [])]
        self.usage = data.get("usage", {})

class _OllamaCompletions:
    def __init__(self, base_url: str, model: str):
        self._base = base_url.rstrip("/")
        self.model = model

    async def create(self, **kwargs):
        import httpx
        payload = {"model": self.model, "messages": kwargs["messages"]}
        if "qwen3" in self.model:
            payload["think"] = False  # keep qwen3 from burning budget on reasoning tokens
        for k in ("max_tokens", "temperature", "top_p", "stream", "response_format"):
            if k in kwargs:
                payload[k] = kwargs[k]
        async with httpx.AsyncClient(timeout=180) as cli:
            r = await cli.post(f"{self._base}/chat/completions", json=payload)
            r.raise_for_status()
            return _OllamaResp(r.json())

    async def stream_create(self, **kwargs):
        """Streaming variant — yields content deltas as they arrive (SSE)."""
        import httpx
        payload = {"model": self.model, "messages": kwargs["messages"], "stream": True}
        if "qwen3" in self.model:
            payload["think"] = False
        for k in ("max_tokens", "temperature", "top_p", "response_format"):
            if k in kwargs:
                payload[k] = kwargs[k]
        async with httpx.AsyncClient(timeout=180) as cli:
            async with cli.stream("POST", f"{self._base}/chat/completions", json=payload) as r:
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        j = json.loads(data)
                        delta = (j.get("choices") or [{}])[0].get("delta", {}).get("content", "")
                        if delta:
                            yield delta
                    except Exception:
                        continue

class _OllamaClient:
    """Drop-in for AsyncGroq: exposes .chat.completions.create()."""

    class _Chat:
        def __init__(self, base_url: str, model: str):
            self.completions = _OllamaCompletions(base_url, model)

    def __init__(self, base_url: str, model: str):
        self.chat = self._Chat(base_url, model)

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

MULTILINGUAL_ALERTS: dict[str, dict[str, str]] = {
    "sos": {
        "en": "[ALERT] SOS EMERGENCY — Patient {name} pressed SOS button in {village}!",
        "te": "[ALERT] SOS అత్యవసర పరిస్థితి — రోగి {name} ({village}) SOS బటన్ నొక్కారు!",
        "hi": "[ALERT] SOS आपातकाल — मरीज {name} ({village}) ने SOS बटन दबाया!",
    },
    "fall": {
        "en": "[ALERT] FALL DETECTED — Patient {name} fell in {village}!",
        "te": "[ALERT] పడిపోవడం కనుగొనబడింది — రోగి {name} ({village}) కింద పడిపోయారు!",
        "hi": "[ALERT] गिरना पकड़ा गया — मरीज {name} ({village}) गिर गए हैं!",
    },
    "spo2_low": {
        "en": "[CRITICAL] LOW SPO2 — {name} SpO2: {value}%. Seek oxygen immediately.",
        "te": "[CRITICAL] తక్కువ SpO2 — {name} SpO2: {value}%. ఆక్సిజన్ అందించండి.",
        "hi": "[CRITICAL] कम SpO2 — {name} SpO2: {value}%. ऑक्सीजन तुरंत दें।",
    },
    "hr_critical": {
        "en": "[CRITICAL] EXTREME HEART RATE — {name} HR: {value} bpm!",
        "te": "[CRITICAL] గుండె వేగం అత్యధికం — {name} HR: {value} bpm!",
        "hi": "[CRITICAL] हृदय गति अत्यधिक — {name} HR: {value} bpm!",
    },
    "hr_warning": {
        "en": "[WARNING] HIGH HEART RATE — {name} HR: {value} bpm",
        "te": "[WARNING] హెచ్చరిక — {name} HR: {value} bpm",
        "hi": "[WARNING] चेतावनी — {name} HR: {value} bpm",
    },
    "temp_high": {
        "en": "[WARNING] FEVER DETECTED — {name} Temp: {value}",
        "te": "[WARNING] జ్వరం కనుగొనబడింది — {name} Temp: {value}",
        "hi": "[WARNING] बुखार — {name} Temp: {value}",
    },
    "flame_detected": {
        "en": "[EMERGENCY] FIRE DETECTED! — Location: {village}. Evacuate immediately!",
        "te": "[EMERGENCY] మంటలు కనుగొన్నారు! — {village} వెంటనే బయటకు వెళ్ళండి!",
        "hi": "[EMERGENCY] आग लगी! — {village} तुरंत बाहर निकलें!",
    },
    "air_quality": {
        "en": "[WARNING] POOR AIR QUALITY — {village} Air: {value} PPM. Ventilate room.",
        "te": "[WARNING] గాలి నాణ్యత చెడ్డది — {value} PPM",
        "hi": "[WARNING] खराब वायु गुणवत्ता — {value} PPM",
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
        self.ollama_client = _OllamaClient(OLLAMA_BASE_URL, OLLAMA_MODEL)
        self.groq_client = AsyncGroq(api_key=self.api_key) if self.api_key else None

        if _ollama_reachable():
            self.provider = "ollama"
            self.model_name = OLLAMA_MODEL
        elif self.groq_client:
            self.provider = "groq"
            self.model_name = GROQ_MODEL
        else:
            self.provider = "none"
            self.model_name = "unavailable"

        self.mode = "auto"  # auto | ollama | groq
        self.client = self.ollama_client if self.provider == "ollama" else (self.groq_client or self.ollama_client)
        self._cooldowns: dict[str, float] = {}
        self.insights: list[AgentInsight] = []
        print(f"[AyuAgent] ✓ Initialized (Mode: {self.mode}, Primary: {self.provider}:{self.model_name}, API Key Fallback: {'Active' if self.groq_client else 'None'})")

    def set_mode(self, mode: str):
        """Switch AI provider mode at runtime ('ollama' | 'groq' | 'auto')."""
        if mode in ("ollama", "groq", "auto"):
            self.mode = mode
            print(f"[AyuAgent] 🔀 AI Provider mode set to: {self.mode.upper()}")
            return True
        return False

    async def create_completion(self, messages: list, max_tokens: int = 250, temperature: float = 0.5, response_format: dict = None) -> str:
        """
        Dynamic chat completion supporting forced 'ollama', forced 'groq', or 'auto' fallback.
        """
        # 1. Forced Groq API Key mode
        if self.mode == "groq":
            if not self.groq_client:
                raise RuntimeError("Groq API key is not configured.")
            kwargs = {"model": GROQ_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
            if response_format:
                kwargs["response_format"] = response_format
            resp = await self.groq_client.chat.completions.create(**kwargs)
            content = resp.choices[0].message.content if (resp and resp.choices) else ""
            if content and content.strip():
                return content.strip()
            raise RuntimeError("Groq API key returned an empty response.")

        # 2. Forced Local Ollama mode
        if self.mode == "ollama":
            if not _ollama_reachable():
                raise RuntimeError("Local Ollama agent is not reachable.")
            kwargs = {"messages": messages, "max_tokens": max_tokens, "temperature": temperature}
            if response_format:
                kwargs["response_format"] = response_format
            resp = await self.ollama_client.chat.completions.create(**kwargs)
            content = resp.choices[0].message.content if (resp and resp.choices) else ""
            if content and content.strip():
                return content.strip()
            raise RuntimeError("Local Ollama agent returned an empty response.")

        # 3. Auto mode (Local Ollama primary -> Groq API Key fallback)
        if _ollama_reachable():
            try:
                kwargs = {"messages": messages, "max_tokens": max_tokens, "temperature": temperature}
                if response_format:
                    kwargs["response_format"] = response_format
                resp = await self.ollama_client.chat.completions.create(**kwargs)
                content = resp.choices[0].message.content if (resp and resp.choices) else ""
                if content and content.strip():
                    return content.strip()
                print("[AyuAgent] ⚠️ Local Ollama returned empty response -> Falling back to Groq API key...")
            except Exception as e:
                print(f"[AyuAgent] ⚠️ Local Ollama error ({e}) -> Falling back to Groq API key...")

        if self.groq_client:
            try:
                kwargs = {"model": GROQ_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
                if response_format:
                    kwargs["response_format"] = response_format
                resp = await self.groq_client.chat.completions.create(**kwargs)
                content = resp.choices[0].message.content if (resp and resp.choices) else ""
                if content and content.strip():
                    return content.strip()
            except Exception as e:
                print(f"[AyuAgent] ❌ Groq API key fallback error: {e}")
                raise e

        raise RuntimeError("No AI response: Both local Ollama and Groq API key failed or are unavailable.")

    async def stream_chat(self, model: str, messages: list, max_tokens: int = 250,
                          temperature: float = 0.5):
        """Token-streaming chat respecting mode configuration."""
        if self.mode == "groq" and self.groq_client:
            stream = await self.groq_client.chat.completions.create(
                model=GROQ_MODEL, messages=messages, max_tokens=max_tokens,
                temperature=temperature, stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta.content if (chunk.choices and chunk.choices[0].delta) else None
                if delta:
                    yield delta
            return

        ollama_yielded = False
        if (self.mode in ("ollama", "auto")) and _ollama_reachable():
            try:
                async for delta in self.ollama_client.chat.completions.stream_create(
                    model=OLLAMA_MODEL, messages=messages, max_tokens=max_tokens, temperature=temperature
                ):
                    if delta:
                        ollama_yielded = True
                        yield delta
                if ollama_yielded:
                    return
            except Exception as e:
                print(f"[AyuAgent] ⚠️ Local Ollama stream error ({e}) -> Falling back to Groq API key stream...")

        if (self.mode in ("groq", "auto")) and self.groq_client:
            try:
                stream = await self.groq_client.chat.completions.create(
                    model=GROQ_MODEL, messages=messages, max_tokens=max_tokens,
                    temperature=temperature, stream=True,
                )
                async for chunk in stream:
                    delta = chunk.choices[0].delta.content if (chunk.choices and chunk.choices[0].delta) else None
                    if delta:
                        yield delta
            except Exception as e:
                print(f"[AyuAgent] ❌ Groq API key stream error: {e}")

    def update_api_key(self, new_key: str):
        """Hot-swap API key at runtime (Groq fallback)."""
        self.api_key = new_key
        self.groq_client = AsyncGroq(api_key=new_key) if new_key else None
        print(f"[AyuAgent] API key updated (Groq fallback active)")

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
            meds = db_mod.get_all_medications(p["id"])
            med_txt = "; ".join(
                f"{m['medicine_name']} {m['dosage']} @{m['schedule_time']} ({m['status']})" for m in meds
            ) or "None"
            return (
                f"Patient: {p['name']}, Age {p.get('age',0)}, Village: {p.get('village','')}, "
                f"Conditions: {conds}, Allergies: {allergies}, Blood: {p.get('blood_group','Unknown')}, "
                f"Language: {p.get('language','Telugu')}, Prescriptions: {med_txt}"
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
            content = await self.create_completion(
                messages=[
                    {"role": "system", "content": "You are a compassionate mental health first-aid assistant. Never diagnose. Always recommend professional help. Be warm and non-judgmental."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=250, temperature=0.6,
            )
            return {"ok": True, "reply": content, "is_distress": True, "helplines": helpline}
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
            content = await self.create_completion(
                messages=[
                    {"role": "system", "content": "You are AyuLink Medical Triage Agent for eldercare IoT. Correlate all signals. Respond in strict JSON with keys: headline, detail, action. Be precise and concise."},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=MAX_TOKENS, temperature=0.4,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(content)
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
            content = await self.create_completion(
                messages=[
                    {"role": "system", "content": "You are a rural eldercare health assistant. Give concise, practical daily health summaries."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=150, temperature=0.5,
            )
            return content
        except Exception as e:
            return f"Unable to generate brief: {e}"

    async def answer_question(self, question: str, patient_context: str = "") -> str:
        """Answer a free-form medical question with patient context."""
        prompt = question
        if patient_context:
            prompt = f"Patient context: {patient_context}\n\nQuestion: {question}"
        try:
            content = await self.create_completion(
                messages=[
                    {"role": "system", "content": "You are AyuLink, a medical AI assistant for rural Indian eldercare. Answer concisely and practically. Always recommend consulting a doctor for serious concerns."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=200, temperature=0.5,
            )
            return content
        except Exception as e:
            return f"AI error: {e}"

    async def health_report(self, patient_id: str) -> Optional[dict]:
        """AI-generated health report from local SQLite trends (no new hardware)."""
        import database as db_mod
        p = db_mod.get_patient(patient_id)
        if not p:
            return None

        vitals = db_mod.get_vitals_history(patient_id, limit=200)
        meds = db_mod.get_all_medications(patient_id)
        alerts = db_mod.get_alerts_history(limit=10)
        risk = compute_risk_score(patient_id)

        def _avg(xs: list) -> float:
            return sum(xs) / len(xs) if xs else 0.0

        if vitals:
            hrs = [v["hr"] for v in vitals if v.get("hr")]
            spo2s = [v["spo2"] for v in vitals if v.get("spo2")]
            temps = [v["temp"] for v in vitals if v.get("temp")]
            hr_r, hr_p = _avg(hrs[:10]), _avg(hrs[10:20]) if len(hrs) > 10 else _avg(hrs[:10])
            stats = (
                f"HR {min(hrs) if hrs else '-'}-{max(hrs) if hrs else '-'} bpm "
                f"(avg {_avg(hrs):.0f}), SpO2 {min(spo2s) if spo2s else '-'}-{max(spo2s) if spo2s else '-'}% "
                f"(avg {_avg(spo2s):.0f}), Temp {min(temps) if temps else '-'}-{max(temps) if temps else '-'} °C"
            )
            trend = f"HR trending: avg {hr_r:.0f} bpm recently vs {hr_p:.0f} earlier"
        else:
            stats = "No recent vitals recorded"
            trend = "No trend available"

        meds_txt = "; ".join(
            f"{m['medicine_name']} {m['dosage']} @{m['schedule_time']} ({m['status']})" for m in meds
        ) or "None"
        alerts_txt = "; ".join(f"{a['severity'].upper()}: {a['message']}" for a in alerts[:5]) or "None"

        conditions = ", ".join(p.get("conditions", []) or []) or "None"
        prompt = (
            f"Write a short medical health report for this elderly patient.\n"
            f"Patient: {p['name']}, Age {p.get('age', 0)}, Village: {p.get('village', '')}, "
            f"Conditions: {conditions}\n"
            f"Vital stats (last 200 readings): {stats}\n"
            f"Trend: {trend}\n"
            f"Prescriptions: {meds_txt}\n"
            f"Recent alerts: {alerts_txt}\n"
            f"Risk score: {risk['score']}/100 ({risk['level']})\n\n"
            "Return ONLY valid JSON with exactly these keys: "
            "summary (2-3 sentences, plain language a village family understands), "
            "concerns (list of 2-3 strings, empty list if none), "
            "recommendation (1-2 sentences: what the family/doctor should do). "
            "No markdown, no extra keys."
        )
        try:
            raw = await self.create_completion(
                messages=[
                    {"role": "system", "content": "You are a rural eldercare AI writing doctor handoff reports. Return only valid JSON."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=300, temperature=0.4,
                response_format={"type": "json_object"},
            )
            import json as _json, re as _re
            raw = _re.sub(r"```json|```", "", raw).strip()
            ai = _json.loads(raw)
        except Exception as e:
            ai = {
                "summary": f"AI could not generate the report: {e}",
                "concerns": [],
                "recommendation": "Please review the patient's vitals manually.",
            }

        return {
            "patient_id": patient_id,
            "patient": p["name"],
            "age": p.get("age", 0),
            "village": p.get("village", ""),
            "conditions": conditions,
            "stats": stats,
            "trend": trend,
            "meds": meds_txt,
            "alerts": alerts_txt,
            "risk_score": risk["score"],
            "risk_level": risk["level"],
            "ai_summary": ai.get("summary", ""),
            "ai_concerns": ai.get("concerns", []),
            "ai_recommendation": ai.get("recommendation", ""),
            "generated_at": int(time.time()),
        }

    def get_recent_insights(self, n: int = 20) -> list[dict]:
        return [i.to_dict() for i in reversed(self.insights[-n:])]

    def clear_insights(self):
        self.insights.clear()

