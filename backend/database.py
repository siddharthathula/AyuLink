"""
AyuLink Local Database — SQLite patient storage, vitals history, reports.
"""
import sqlite3, json, time, os, uuid, base64
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(__file__).parent / "ayulink.db"


@contextmanager
def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS patients (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            age INTEGER,
            gender TEXT DEFAULT 'Unknown',
            village TEXT,
            phone TEXT,
            emergency_contact TEXT,
            blood_group TEXT,
            conditions TEXT DEFAULT '[]',
            allergies TEXT DEFAULT '[]',
            abha_id TEXT,
            ration_card_type TEXT,
            language TEXT DEFAULT 'Telugu',
            photo_b64 TEXT,
            lat REAL DEFAULT 18.0539,
            lng REAL DEFAULT 79.5357,
            device_status TEXT DEFAULT 'offline',
            created_at REAL,
            updated_at REAL
        );

        CREATE TABLE IF NOT EXISTS vitals_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id TEXT NOT NULL,
            hr INTEGER,
            spo2 INTEGER,
            temp REAL,
            fall INTEGER DEFAULT 0,
            sos INTEGER DEFAULT 0,
            risk_score INTEGER DEFAULT 0,
            timestamp REAL,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        );

        CREATE TABLE IF NOT EXISTS alerts_history (
            id TEXT PRIMARY KEY,
            patient_id TEXT,
            alert_type TEXT,
            severity TEXT,
            message TEXT,
            value TEXT,
            resolved INTEGER DEFAULT 0,
            timestamp REAL
        );

        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            patient_id TEXT NOT NULL,
            title TEXT,
            type TEXT DEFAULT 'general',
            content TEXT,
            image_b64 TEXT,
            created_at REAL,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            patient_id TEXT,
            title TEXT,
            message TEXT,
            type TEXT DEFAULT 'info',
            sent INTEGER DEFAULT 0,
            sent_to_device INTEGER DEFAULT 0,
            created_at REAL
        );
        """)
    print(f"[DB] ✓ SQLite initialized at {DB_PATH}")


# ── Patient CRUD ──

def create_patient(data: dict) -> dict:
    pid = data.get("id", f"P-{str(uuid.uuid4())[:6].upper()}")
    now = time.time()
    with get_db() as db:
        db.execute("""
            INSERT OR REPLACE INTO patients
            (id, name, age, gender, village, phone, emergency_contact,
             blood_group, conditions, allergies, abha_id, ration_card_type,
             language, photo_b64, lat, lng, device_status, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            pid, data.get("name", ""), data.get("age", 0), data.get("gender", "Unknown"),
            data.get("village", "Hanamkonda"), data.get("phone", ""),
            data.get("emergency_contact", ""), data.get("blood_group", ""),
            json.dumps(data.get("conditions", [])), json.dumps(data.get("allergies", [])),
            data.get("abha_id", ""), data.get("ration_card_type", ""),
            data.get("language", "Telugu"), data.get("photo_b64", ""),
            data.get("lat", 18.0539), data.get("lng", 79.5357),
            data.get("device_status", "offline"), now, now,
        ))
    return get_patient(pid)


def get_patient(pid: str) -> dict | None:
    with get_db() as db:
        row = db.execute("SELECT * FROM patients WHERE id=?", (pid,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["conditions"] = json.loads(d.get("conditions") or "[]")
        d["allergies"] = json.loads(d.get("allergies") or "[]")
        return d


def get_all_patients() -> list[dict]:
    with get_db() as db:
        rows = db.execute("SELECT * FROM patients ORDER BY created_at DESC").fetchall()
        result = []
        for row in rows:
            d = dict(row)
            d["conditions"] = json.loads(d.get("conditions") or "[]")
            d["allergies"] = json.loads(d.get("allergies") or "[]")
            result.append(d)
        return result


def delete_patient(pid: str) -> bool:
    with get_db() as db:
        db.execute("DELETE FROM patients WHERE id=?", (pid,))
        return True


def get_patient_count() -> int:
    with get_db() as db:
        return db.execute("SELECT COUNT(*) FROM patients").fetchone()[0]


# ── Vitals History ──

def save_vital(patient_id: str, hr: int, spo2: int, temp: float,
               fall: bool = False, sos: bool = False, risk: int = 0):
    with get_db() as db:
        db.execute("""
            INSERT INTO vitals_history (patient_id, hr, spo2, temp, fall, sos, risk_score, timestamp)
            VALUES (?,?,?,?,?,?,?,?)
        """, (patient_id, hr, spo2, temp, int(fall), int(sos), risk, time.time()))


def get_vitals_history(patient_id: str, limit: int = 100) -> list[dict]:
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM vitals_history WHERE patient_id=? ORDER BY timestamp DESC LIMIT ?",
            (patient_id, limit)
        ).fetchall()
        return [dict(r) for r in rows]


# ── Reports ──

def create_report(patient_id: str, title: str, content: str,
                  report_type: str = "general", image_b64: str = "") -> dict:
    rid = str(uuid.uuid4())[:8]
    now = time.time()
    with get_db() as db:
        db.execute("""
            INSERT INTO reports (id, patient_id, title, type, content, image_b64, created_at)
            VALUES (?,?,?,?,?,?,?)
        """, (rid, patient_id, title, report_type, content, image_b64, now))
    return {"id": rid, "patient_id": patient_id, "title": title, "created_at": now}


def get_patient_reports(patient_id: str) -> list[dict]:
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM reports WHERE patient_id=? ORDER BY created_at DESC", (patient_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def delete_report(report_id: str) -> bool:
    with get_db() as db:
        db.execute("DELETE FROM reports WHERE id=?", (report_id,))
        return True


# ── Notifications ──

def create_notification(patient_id: str, title: str, message: str,
                        ntype: str = "info") -> dict:
    nid = str(uuid.uuid4())[:8]
    now = time.time()
    with get_db() as db:
        db.execute("""
            INSERT INTO notifications (id, patient_id, title, message, type, created_at)
            VALUES (?,?,?,?,?,?)
        """, (nid, patient_id, title, message, ntype, now))
    return {"id": nid, "patient_id": patient_id, "title": title, "message": message,
            "type": ntype, "created_at": now}


def get_notifications(limit: int = 50) -> list[dict]:
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def mark_notification_sent(nid: str, to_device: bool = False):
    with get_db() as db:
        if to_device:
            db.execute("UPDATE notifications SET sent=1, sent_to_device=1 WHERE id=?", (nid,))
        else:
            db.execute("UPDATE notifications SET sent=1 WHERE id=?", (nid,))


# ── Alerts History ──

def save_alert(alert_id: str, patient_id: str, alert_type: str,
               severity: str, message: str, value: str):
    with get_db() as db:
        db.execute("""
            INSERT OR IGNORE INTO alerts_history (id, patient_id, alert_type, severity, message, value, timestamp)
            VALUES (?,?,?,?,?,?,?)
        """, (alert_id, patient_id, alert_type, severity, message, value, time.time()))


def get_alerts_history(limit: int = 100) -> list[dict]:
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM alerts_history ORDER BY timestamp DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


# ── Full Patient Context for AI ──

def get_all_patients_summary() -> str:
    """Get a compact text summary of all patients for the AI agent."""
    patients = get_all_patients()
    if not patients:
        return "No patients registered in the database."
    lines = []
    for p in patients:
        conds = ", ".join(p.get("conditions", [])) or "None"
        lines.append(
            f"- {p['name']} (ID: {p['id']}, Age: {p.get('age',0)}, "
            f"Village: {p.get('village','')}, Conditions: {conds}, "
            f"Status: {p.get('device_status','offline')})"
        )
    return f"Registered patients ({len(patients)}):\n" + "\n".join(lines)
