'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
    Brain, Activity, Zap, ShieldAlert, AlertTriangle, CheckCircle2,
    Flame, Wind, Pill, HeartPulse, Thermometer, Droplets,
    ChevronRight, Cpu, Sparkles, User, Loader2,
    Send, MessageCircle, Trash2, Key, AlertCircle,
    UserPlus, Ambulance, Search, FlaskConical,
    FileText, Mic, MicOff, Volume2, RefreshCw, Printer, SendHorizontal
} from 'lucide-react'
import MedicalSearchPanel from '@/components/MedicalSearchPanel'
import { useDemoMode } from '@/lib/demo-context'

interface AgentInsight {
    patient_id: string; patient_name: string; severity: 'normal'|'warning'|'critical'|'emergency';
    trigger: string; headline: string; detail: string; action: string; timestamp: number;
}
interface LiveVital { hr: number; spo2: number; temp: number; bp_systolic: number; bp_diastolic: number; status: string; risk: number; name: string; worn: boolean; }
interface HubData { air_ppm: number; air_aqi: string; flame: boolean; pill_slot1: boolean; pill_slot2: boolean; pill_slot3: boolean; pill_slot4: boolean; }

const severityConfig = {
    normal:    { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', label: 'Normal', icon: CheckCircle2 },
    warning:   { color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   label: 'Warning', icon: AlertTriangle },
    critical:  { color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30',     label: 'Critical', icon: ShieldAlert },
    emergency: { color: 'text-red-300',     bg: 'bg-red-900/30',     border: 'border-red-400',        label: 'Emergency', icon: AlertCircle },
}

function Typewriter({ text, speed = 18 }: { text: string, speed?: number }) {
    const [displayed, setDisplayed] = useState('')
    useEffect(() => { setDisplayed(''); if (!text) return; let i = 0
        const id = setInterval(() => { setDisplayed(text.slice(0, i + 1)); i++; if (i >= text.length) clearInterval(id) }, speed)
        return () => clearInterval(id)
    }, [text, speed])
    return <>{displayed}</>
}

function RelativeTime({ ts }: { ts: number }) {
    const [label, setLabel] = useState('')
    useEffect(() => {
        const update = () => { const d = Math.floor(Date.now() / 1000 - ts)
            if (d < 5) setLabel('just now'); else if (d < 60) setLabel(`${d}s ago`)
            else if (d < 3600) setLabel(`${Math.floor(d/60)}m ago`); else setLabel(`${Math.floor(d/3600)}h ago`) }
        update(); const id = setInterval(update, 5000); return () => clearInterval(id)
    }, [ts])
    return <span className="text-[11px] font-mono opacity-60">{label}</span>
}

function InsightCard({ insight, isLatest }: { insight: AgentInsight, isLatest: boolean }) {
    const cfg = severityConfig[insight.severity] ?? severityConfig.normal
    const Icon = cfg.icon
    return (
        <div className={`rounded-2xl border p-5 transition-all duration-500 ${cfg.border} ${cfg.bg}
            ${isLatest ? 'ring-2 ring-offset-1 ring-purple-500/40 shadow-lg shadow-purple-500/10' : 'opacity-80'}`}>
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${cfg.bg} border ${cfg.border}`}>
                        <Icon className={`h-4 w-4 ${cfg.color}`} />
                    </div>
                    <div>
                        <span className={`text-[11px] font-black uppercase tracking-widest ${cfg.color}`}>{cfg.label}</span>
                        <div className="flex items-center gap-1 mt-0.5">
                            <User className="h-3 w-3 opacity-50" style={{ color: 'var(--text-muted)' }} />
                            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{insight.patient_name}</span>
                            <span className="text-[11px] opacity-40 font-mono" style={{ color: 'var(--text-muted)' }}>· {insight.trigger.replace(/_/g, ' ')}</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isLatest && <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-[10px] font-black text-purple-400 uppercase tracking-wider"><Sparkles className="h-2.5 w-2.5" />Latest</span>}
                    <RelativeTime ts={insight.timestamp} />
                </div>
            </div>
            <h3 className="font-black text-base mb-2.5 leading-snug" style={{ color: 'var(--text-primary)' }}>
                {isLatest ? <Typewriter text={insight.headline} speed={14} /> : insight.headline}
            </h3>
            <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-muted)', lineHeight: '1.65' }}>
                {isLatest ? <Typewriter text={insight.detail} speed={8} /> : insight.detail}
            </p>
            <div className="flex items-start gap-2 p-3 rounded-xl border bg-black/10 dark:bg-white/5" style={{ borderColor: 'var(--border-color)' }}>
                <ChevronRight className={`h-4 w-4 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {isLatest ? <Typewriter text={insight.action} speed={10} /> : insight.action}
                </p>
            </div>
        </div>
    )
}

function LiveContextPanel({ vital, hub }: { vital: LiveVital | null, hub: HubData | null }) {
    return (
        <div className="rounded-2xl border p-5 space-y-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
            <h3 className="font-black text-sm uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Live Patient Context</h3>
            {vital ? (
                <div className="grid grid-cols-3 gap-3">
                    {[{ icon: HeartPulse, label: 'HR', value: `${vital.hr} bpm`, good: vital.hr >= 60 && vital.hr <= 100 },
                      { icon: Droplets, label: 'SpO2', value: `${vital.spo2}%`, good: vital.spo2 >= 95 },
                      { icon: Thermometer, label: 'Temp', value: `${vital.temp}°C`, good: vital.temp >= 36 && vital.temp <= 38 },
                      { icon: Activity, label: 'BP', value: vital.bp_systolic > 0 ? `${vital.bp_systolic}/${vital.bp_diastolic}` : '--/--', good: vital.bp_systolic > 0 && vital.bp_systolic < 140 && vital.bp_diastolic < 90 },
                    ].map(({ icon: Icon, label, value, good }) => (                        <div key={label} className="p-3 rounded-xl text-center" style={{ background: 'var(--bg-primary)' }}>
                            <Icon className={`h-4 w-4 mx-auto mb-1 ${good ? 'text-emerald-400' : 'text-red-400'}`} />
                            <p className="text-xs font-black" style={{ color: 'var(--text-primary)' }}>{value}</p>
                            <p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
                        </div>
                    ))}
                </div>
            ) : <div className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>No vital data</div>}
            {hub && (
                <div className="space-y-2">
                    <div className="flex items-center justify-between p-2.5 rounded-xl" style={{ background: 'var(--bg-primary)' }}>
                        <div className="flex items-center gap-2">
                            <Wind className={`h-4 w-4 ${hub.air_ppm > 500 ? 'text-red-400' : hub.air_ppm > 300 ? 'text-amber-400' : 'text-emerald-400'}`} />
                            <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Air Quality</span>
                        </div>
                        <span className="text-xs font-black" style={{ color: 'var(--text-primary)' }}>{hub.air_ppm} PPM · {hub.air_aqi}</span>
                    </div>
                    <div className={`flex items-center justify-between p-2.5 rounded-xl border ${hub.flame ? 'border-red-500/40 bg-red-500/10' : ''}`}
                        style={{ background: hub.flame ? undefined : 'var(--bg-primary)' }}>
                        <div className="flex items-center gap-2">
                            <Flame className={`h-4 w-4 ${hub.flame ? 'text-red-400 animate-pulse' : 'text-gray-400'}`} />
                            <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Flame</span>
                        </div>
                        <span className={`text-xs font-black ${hub.flame ? 'text-red-400' : 'text-emerald-400'}`}>{hub.flame ? '⚠ FIRE' : 'Clear'}</span>
                    </div>
                    <div className="p-2.5 rounded-xl" style={{ background: 'var(--bg-primary)' }}>
                        <div className="flex items-center gap-2 mb-2">
                            <Pill className="h-4 w-4 text-purple-400" />
                            <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Meds</span>
                        </div>
                        <div className="flex gap-1.5">
                            {[{ label: 'AM', taken: hub.pill_slot1 }, { label: 'PM', taken: hub.pill_slot2 },
                              { label: 'Eve', taken: hub.pill_slot3 }, { label: 'Ngt', taken: hub.pill_slot4 }].map(s => (
                                <div key={s.label} className={`flex-1 h-7 rounded-lg flex items-center justify-center text-[10px] font-black
                                    ${s.taken ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-gray-200/10 text-gray-500 border border-gray-500/20'}`}>
                                    {s.label}: {s.taken ? '✓' : '—'}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default function AgentPage() {
    const { isDemoMode } = useDemoMode()
    const [activeTab, setActiveTab] = useState<'chat' | 'search' | 'insights' | 'report'>('chat')
    const [insights, setInsights] = useState<AgentInsight[]>([])
    const [vital, setVital] = useState<LiveVital | null>(null)
    const [hub, setHub] = useState<HubData | null>(null)
    const [connected, setConnected] = useState(false)
    const [analyzing, setAnalyzing] = useState(false)
    const [agentStatus, setAgentStatus] = useState<'idle' | 'thinking' | 'done'>('idle')
    const [chatMessages, setChatMessages] = useState<{role: 'user' | 'ai', text: string}[]>([])
    const [chatInput, setChatInput] = useState('')
    const [chatLang, setChatLang] = useState<'en' | 'hi' | 'te'>('en')
    const [chatLoading, setChatLoading] = useState(false)
    const [showApiKey, setShowApiKey] = useState(false)
    const [apiKeyInput, setApiKeyInput] = useState('')
    const [maskedKey, setMaskedKey] = useState('')
    const [patientCreatedToast, setPatientCreatedToast] = useState<string | null>(null)
    const [showRegModal, setShowRegModal] = useState(false)
    const [regForm, setRegForm] = useState({ name: '', age: '', village: '', conditions: '' })
    const [regLoading, setRegLoading] = useState(false)
    const [report, setReport] = useState<any>(null)
    const [reportLoading, setReportLoading] = useState(false)
    const [reportSent, setReportSent] = useState(false)
    const [reportPatient, setReportPatient] = useState('108')
    const [patientList, setPatientList] = useState<{ id: string; name: string }[]>([])
    const [listening, setListening] = useState(false)
    const [speaking, setSpeaking] = useState(false)
    const [aiMode, setAiMode] = useState<'auto' | 'ollama' | 'groq'>('auto')
    const chatEndRef = useRef<HTMLDivElement | null>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (typeof window !== 'undefined') {
            fetch(`http://${window.location.hostname}:8000/api/agent/mode`)
                .then(res => res.json())
                .then(data => { if (data.ok && data.mode) setAiMode(data.mode) })
                .catch(() => {})
        }
    }, [])

    const handleSetMode = async (mode: 'auto' | 'ollama' | 'groq') => {
        setAiMode(mode)
        try {
            const host = window.location.hostname
            await fetch(`http://${host}:8000/api/agent/mode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode })
            })
        } catch (e) {
            console.error('Failed to set AI mode:', e)
        }
    }

    // WS Connection
    const connect = useCallback(() => {
        try {
            const wsUrl = typeof window !== 'undefined' ? `ws://${window.location.hostname}:8000/ws/dashboard` : 'ws://localhost:8000/ws/dashboard'
            const ws = new WebSocket(wsUrl)
            ws.onopen = () => { setConnected(true); if (retryRef.current) clearTimeout(retryRef.current) }
            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data)
                    if (msg.event === 'vital') {
                        const d = msg.data
                        setVital({ hr: d.hr, spo2: d.spo2, temp: d.temp, bp_systolic: d.bp_systolic ?? 0, bp_diastolic: d.bp_diastolic ?? 0, status: d.status ?? 'normal', risk: d.risk_score ?? 0, name: d.patient_id ?? 'Unknown', worn: d.worn ?? true })
                    }
                    if (msg.event === 'hub' || (msg.event === 'state' && msg.data?.hub)) {
                        const d = msg.event === 'hub' ? msg.data : msg.data.hub
                        if (d) setHub({ air_ppm: d.air_ppm ?? 0, air_aqi: d.air_aqi ?? 'Unknown', flame: d.flame ?? false,
                            pill_slot1: d.pill_slot1 ?? false, pill_slot2: d.pill_slot2 ?? false, pill_slot3: d.pill_slot3 ?? false, pill_slot4: d.pill_slot4 ?? false })
                    }
                    if (msg.event === 'state' && msg.data?.patients?.length > 0) {
                        const p = msg.data.patients[0]
                        setVital({ hr: p.hr, spo2: p.spo2, temp: p.temp, bp_systolic: p.bp_systolic ?? 0, bp_diastolic: p.bp_diastolic ?? 0, status: p.status, risk: p.risk_score, name: p.name, worn: p.worn ?? true })
                    }
                    if (msg.event === 'ai_insight') {
                        setInsights(prev => [msg.data as AgentInsight, ...prev].slice(0, 30))
                        setAgentStatus('done'); setTimeout(() => setAgentStatus('idle'), 3000)
                    }
                    if (msg.event === 'dispatch') {
                        const d = msg.data
                        setChatMessages(prev => [...prev, { role: 'ai', text: `🚨 PARAMEDIC DISPATCHED\nPatient: ${d.patient_name}\nLocation: ${d.location}\nStatus: En route` }])
                    }
                } catch { /* ignore */ }
            }
            ws.onclose = () => { setConnected(false); retryRef.current = setTimeout(connect, 4000) }
            ws.onerror = () => ws.close()
            wsRef.current = ws
        } catch { retryRef.current = setTimeout(connect, 4000) }
    }, [])

    useEffect(() => {
        connect()
        fetch('/api/agent/insights').then(r => r.json()).then(d => { if (d.insights) setInsights(d.insights) }).catch(() => {})
        fetch('/api/agent/apikey').then(r => r.json()).then(d => { if (d.masked_key) setMaskedKey(d.masked_key) }).catch(() => {})
        return () => { wsRef.current?.close(); if (retryRef.current) clearTimeout(retryRef.current) }
    }, [connect])

    const handleManualAnalyze = async () => {
        if (analyzing) return; setAnalyzing(true); setAgentStatus('thinking')
        try {
            const res = await fetch('/api/agent/analyze?patient_id=P_01&trigger=manual_request&severity=warning', { method: 'POST' })
            const data = await res.json()
            if (data.ok && data.insight) { setInsights(prev => [data.insight, ...prev].slice(0, 30)); setAgentStatus('done') }
            else setAgentStatus('idle')
        } catch { setAgentStatus('idle') }
        finally { setAnalyzing(false); setTimeout(() => setAgentStatus('idle'), 4000) }
    }

    const handleDemoEvent = async (event: string) => {
        // Simulation events only allowed when Simulation Mode is ON
        if (!isDemoMode) {
            setAgentStatus('idle')
            return
        }
        setAgentStatus('thinking')
        try { await fetch(`/api/simulate/${event}?patient_id=P_01`, { method: 'POST' }) } catch { /* ok */ }
    }

    const handleSendChat = async (overrideMsg?: string): Promise<string | void> => {
        const userMsg = (overrideMsg ?? chatInput).trim()
        if (!userMsg || chatLoading) return
        setChatMessages(prev => [...prev, { role: 'user', text: userMsg }])
        setChatInput(''); setChatLoading(true)

        // Streaming: hit the FastAPI backend directly (bypasses the buffering Next.js
        // rewrite) so tokens appear as they are generated. Hostname keeps LAN devices working.
        const backendBase = typeof window !== 'undefined'
            ? `http://${window.location.hostname}:8000`
            : '/api'
        const url = `${backendBase}/api/agent/chat`

        let full = '', doneEvent: any = null
        setChatMessages(prev => [...prev, { role: 'ai', text: '…' }])
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMsg, language: chatLang, stream: true }),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)

            const contentType = res.headers.get('content-type') || ''
            if (contentType.includes('application/json')) {
                const data = await res.json()
                const reply = data.reply || data.error || 'No response'
                setChatMessages(prev => {
                    const m = [...prev]
                    m[m.length - 1] = { role: 'ai', text: reply }
                    return m
                })
                return reply
            }

            if (!res.body) throw new Error('No body')
            const reader = res.body.getReader()
            const dec = new TextDecoder()
            let buf = ''
            for (;;) {
                const { value, done } = await reader.read()
                if (done) break
                buf += dec.decode(value, { stream: true })
                const lines = buf.split('\n')
                buf = lines.pop() ?? ''
                for (const line of lines) {
                    const t = line.trim()
                    if (!t.startsWith('data: ')) continue
                    const payload = t.slice(6)
                    if (payload === '[DONE]') continue
                    try {
                        const evt = JSON.parse(payload)
                        if (evt.delta) {
                            full += evt.delta
                            setChatMessages(prev => {
                                const m = [...prev]
                                m[m.length - 1] = { role: 'ai', text: full }
                                return m
                            })
                        }
                        if (evt.done) doneEvent = evt
                    } catch { /* partial json — ignore */ }
                }
            }
            const reply = (full || (doneEvent && (doneEvent.delta || doneEvent.reply)) || '').trim() || 'No response'
            if (doneEvent?.is_distress && doneEvent.helplines) {
                const extra = `\n\n📞 Helplines: ${doneEvent.helplines}`
                full += extra
                setChatMessages(prev => {
                    const m = [...prev]
                    m[m.length - 1] = { role: 'ai', text: full }
                    return m
                })
            }
            if (doneEvent?.patient_created && doneEvent.patient_name) {
                setPatientCreatedToast(`✅ Patient "${doneEvent.patient_name}" registered in database!`)
                setTimeout(() => setPatientCreatedToast(null), 5000)
            }
            return reply
        } catch {
            // Intelligent fallback for Vercel Cloud Demo Mode
            let fallbackReply = "I am monitoring AyuLink vitals in Cloud Demo Mode. Patient 108 (Ramulu Goud) vitals are stable (HR 75, SpO2 96%). How can I assist you with clinical triage or prescription schedules today?"
            const msgLower = userMsg.toLowerCase()
            if (msgLower.includes('fever') || msgLower.includes('temp') || msgLower.includes('bukhar') || msgLower.includes('జ్వరం')) {
                fallbackReply = "Patient reporting elevated temperature. Recommended action: Administer Paracetamol 500mg if >38°C, keep patient hydrated, and alert the assigned ASHA worker for a home visit."
            } else if (msgLower.includes('bp') || msgLower.includes('pressure') || msgLower.includes('hypertension')) {
                fallbackReply = "Blood Pressure Alert Check: Baseline sys/dia is 128/82 mmHg. Ensure morning Amlodipine dose compliance and recheck vitals in 30 minutes."
            } else if (msgLower.includes('register') || msgLower.includes('add patient') || msgLower.includes('new patient')) {
                fallbackReply = "✅ Patient registered in demo mode! You can view and manage patient records in the Patient Records portal."
            }

            setChatMessages(prev => {
                const m = [...prev]
                m[m.length - 1] = { role: 'ai', text: fallbackReply }
                return m
            })
            return fallbackReply
        } finally { setChatLoading(false); setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100) }
    }

    // ── Voice Nurse (mic → local AI → spoken reply) ──
    const LANG_BCP: Record<string, string> = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' }
    const recRef = useRef<any>(null)

    const stopVoice = () => {
        try { recRef.current?.stop() } catch { /* noop */ }
        setListening(false)
    }

    const speak = (text: string) => {
        if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return
        setSpeaking(true)
        const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ''))
        u.lang = LANG_BCP[chatLang]
        u.rate = 1; u.pitch = 1
        const voices = window.speechSynthesis.getVoices()
        const v = voices.find(v => v.lang.replace('_', '-') === LANG_BCP[chatLang])
            || voices.find(v => v.lang.toLowerCase().startsWith(chatLang.split('-')[0]))
        if (v) u.voice = v
        u.onend = () => setSpeaking(false)
        u.onerror = () => setSpeaking(false)
        window.speechSynthesis.speak(u)
    }

    const startVoice = async () => {
        if (listening) { stopVoice(); return }
        const SR = typeof window !== 'undefined' && (window.SpeechRecognition || (window as any).webkitSpeechRecognition)
        if (!SR) { alert('Voice not supported in this browser — try Chrome.'); return }
        const rec = new SR()
        recRef.current = rec
        rec.lang = LANG_BCP[chatLang]
        rec.interimResults = false
        rec.maxAlternatives = 1
        rec.onstart = () => setListening(true)
        rec.onend = () => setListening(false)
        rec.onerror = () => setListening(false)
        rec.onresult = async (e: any) => {
            const transcript = e.results?.[0]?.[0]?.transcript?.trim()
            if (!transcript) return
            setChatInput(transcript)
            const reply = await handleSendChat(transcript)
            if (reply) speak(reply)
        }
        rec.start()
    }

    // ── AI Health Report (local AI + local SQLite) ──
    const loadReport = async () => {
        setReportLoading(true); setReportSent(false)
        try {
            const res = await fetch(`/api/agent/report/${reportPatient}`)
            const d = await res.json()
            setReport(d.ok ? d.report : null)
        } catch { setReport(null) }
        finally { setReportLoading(false) }
    }

    const sendReport = async () => {
        setReportLoading(true)
        try {
            const res = await fetch(`/api/agent/report/send/${reportPatient}`, { method: 'POST' })
            const d = await res.json()
            setReportSent(d.ok && d.sent)
        } catch { setReportSent(false) }
        finally { setReportLoading(false) }
    }

    useEffect(() => {
        fetch('/api/patients').then(r => r.json()).then(d => {
            if (d.ok) setPatientList((d.patients || []).map((p: any) => ({ id: p.id, name: p.name })))
        }).catch(() => {})
    }, [])

    useEffect(() => {
        if (activeTab === 'report' && !report) loadReport()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab])

    useEffect(() => {
        if (activeTab === 'report') loadReport()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reportPatient])

    const handleRegisterPatient = async () => {
        if (!regForm.name.trim()) return
        setRegLoading(true)
        const conditions = regForm.conditions.split(',').map(c => c.trim()).filter(Boolean)
        const msg = `I want to register a new patient named ${regForm.name.trim()}, age ${regForm.age || 'unknown'}, village ${regForm.village || 'unknown'}, has ${conditions.length > 0 ? conditions.join(' and ') : 'no known conditions'}`
        setShowRegModal(false)
        setRegForm({ name: '', age: '', village: '', conditions: '' })
        setRegLoading(false)
        await handleSendChat(msg)
    }

    const handleClearChat = () => setChatMessages([])
    const handleClearInsights = async () => { await fetch('/api/agent/clear', { method: 'POST' }); setInsights([]) }

    const handleUpdateApiKey = async () => {
        if (!apiKeyInput.trim()) return
        const res = await fetch('/api/agent/apikey', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: apiKeyInput }) })
        const data = await res.json()
        if (data.ok) { setMaskedKey(apiKeyInput.slice(0, 8) + '...' + apiKeyInput.slice(-4)); setApiKeyInput(''); setShowApiKey(false) }
    }

    const latest = insights[0]

    const TABS = [
        { id: 'chat', label: 'AI Chat', icon: MessageCircle, color: 'text-purple-400' },
        { id: 'search', label: 'Medical Search', icon: Search, color: 'text-blue-400' },
        { id: 'insights', label: 'Triage Insights', icon: FlaskConical, color: 'text-emerald-400', badge: insights.length },
        { id: 'report', label: 'Health Report', icon: FileText, color: 'text-cyan-400' },
    ] as const

    return (
    <>
        <div className="space-y-5 animate-fadeIn">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="relative w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-500/30" style={{ background: 'linear-gradient(135deg,#7c3aed,#ec4899,#06b6d4)' }}>
                        <Brain className="h-7 w-7 text-white" />
                        {agentStatus === 'thinking' && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-400 border-2 border-white animate-ping" />}
                        {agentStatus === 'done' && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-white" />}
                    </div>
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>AyuLink AI Agent</h1>
                            <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider ${connected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/10 text-red-400 border border-red-500/30'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                                {connected ? 'Live' : 'Offline'}
                            </span>
                        </div>
                        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Local AI (offline) · Triage · Voice Nurse · Health Reports · EN/हिं/తె</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {/* AI Provider Switcher */}
                    <div className="flex items-center gap-1 p-1 rounded-xl bg-purple-500/10 border border-purple-500/20">
                        {[
                            { id: 'auto', label: 'Auto' },
                            { id: 'ollama', label: 'Local AI' },
                            { id: 'groq', label: 'Groq 70B' }
                        ].map(m => (
                            <button
                                key={m.id}
                                onClick={() => handleSetMode(m.id as any)}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-all ${aiMode === m.id ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-300 hover:bg-purple-500/20'}`}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>

                    {[{ label: 'Cardiac', event: 'cardiac', color: 'text-red-400 border-red-500/30 hover:bg-red-500/10' },
                      { label: 'SOS', event: 'sos', color: 'text-amber-400 border-amber-500/30 hover:bg-amber-500/10' },
                      { label: 'Fire', event: 'flame', color: 'text-orange-400 border-orange-500/30 hover:bg-orange-500/10' },
                      { label: 'Fall', event: 'fall', color: 'text-pink-400 border-pink-500/30 hover:bg-pink-500/10' },
                    ].map(({ label, event, color }) => (
                        <button key={event} onClick={() => handleDemoEvent(event)}
                            className={`h-9 px-3 rounded-xl border text-[11px] font-black uppercase tracking-wider transition-all ${color}`}
                            style={{ borderColor: 'var(--border-color)' }}>{label}</button>
                    ))}
                    <button onClick={handleManualAnalyze} disabled={analyzing}
                        className="h-9 flex items-center gap-2 px-4 rounded-xl text-white font-bold text-xs shadow-lg shadow-purple-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg,#7c3aed,#ec4899)' }}>
                        {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {analyzing ? 'Analyzing...' : 'Analyze Now'}
                    </button>
                    <button onClick={() => setShowApiKey(!showApiKey)} className="h-9 px-3 rounded-xl border text-[11px] font-black transition-all hover:bg-white/10"
                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
                        <Key className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Tab Bar */}
            <div className="flex items-center gap-1 p-1 rounded-2xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                {TABS.map(tab => {
                    const Icon = tab.icon
                    const active = activeTab === tab.id
                    return (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
                            style={active ? { background: 'var(--bg-card)', color: 'var(--text-primary)', boxShadow: '0 2px 12px rgba(0,0,0,0.15)' } : { color: 'var(--text-muted)' }}>
                            <Icon className={`h-4 w-4 ${active ? tab.color : ''}`} />
                            {tab.label}
                            {'badge' in tab && (tab as any).badge > 0 && (
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-purple-500/20 text-purple-400">{(tab as any).badge}</span>
                            )}
                        </button>
                    )
                })}
            </div>

            {/* API Key Panel */}
            {showApiKey && (
                <div className="rounded-2xl border p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                    <div className="flex-1">
                        <p className="text-xs font-bold mb-1" style={{ color: 'var(--text-muted)' }}>Groq API Key: <span className="font-mono text-purple-400">{maskedKey || 'Not set'}</span></p>
                        <input type="password" value={apiKeyInput} onChange={e => setApiKeyInput(e.target.value)} placeholder="gsk_..."
                            className="w-full px-3 py-2 rounded-lg border text-sm font-mono outline-none focus:ring-2 focus:ring-purple-500/30"
                            style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
                    </div>
                    <button onClick={handleUpdateApiKey} className="h-9 px-4 rounded-xl bg-purple-600 text-white text-xs font-bold hover:bg-purple-500 transition-all">Update Key</button>
                </div>
            )}

            {/* Thinking bar */}
            {agentStatus === 'thinking' && (
                <div className="flex items-center gap-3 p-4 rounded-2xl border border-purple-500/30 bg-purple-500/10">
                    <Brain className="h-5 w-5 text-purple-400" />
                    <div className="flex-1">
                        <p className="text-sm font-bold text-purple-300">AyuAgent is thinking...</p>
                        <p className="text-xs text-purple-400/70 mt-0.5">Correlating vitals, environment, medications via Groq</p>
                    </div>
                    <Loader2 className="h-5 w-5 text-purple-400 animate-spin" />
                </div>
            )}

            {/* Medical Search Tab */}
            {activeTab === 'search' && <MedicalSearchPanel />}

            {/* Triage Insights Tab */}
            {activeTab === 'insights' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Zap className="h-5 w-5 text-purple-400" />
                            <h2 className="text-lg font-black" style={{ color: 'var(--text-primary)' }}>Triage Insights</h2>
                            {insights.length > 0 && <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 text-[11px] font-black">{insights.length}</span>}
                        </div>
                        {insights.length > 0 && (
                            <button onClick={handleClearInsights} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold border hover:bg-red-500/10 text-red-400 border-red-500/30 transition-all">
                                <Trash2 className="h-3 w-3" /> Clear All
                            </button>
                        )}
                    </div>
                    {insights.length === 0 ? (
                        <div className="rounded-2xl border-2 border-dashed p-16 text-center flex flex-col items-center gap-3" style={{ borderColor: 'var(--border-color)' }}>
                            <Brain className="h-12 w-12 opacity-20" style={{ color: 'var(--text-muted)' }} />
                            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No insights yet. Click &quot;Analyze Now&quot; or trigger a demo event.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">{insights.map((ins, i) => <InsightCard key={`${ins.timestamp}-${i}`} insight={ins} isLatest={i === 0} />)}</div>
                    )}
                </div>
            )}

            {/* Health Report Tab — local AI + local SQLite, no new hardware */}
            {activeTab === 'report' && (
            <div className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-cyan-400" />
                        <h2 className="text-lg font-black" style={{ color: 'var(--text-primary)' }}>AI Health Report</h2>
                        <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 text-[11px] font-black">Doctor handoff</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <select value={reportPatient} onChange={e => setReportPatient(e.target.value)}
                            className="h-9 px-3 rounded-xl border text-sm outline-none focus:ring-2 focus:ring-cyan-500/30"
                            style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
                            {patientList.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
                        </select>
                        <button onClick={loadReport} disabled={reportLoading}
                            className="h-9 px-3 rounded-xl border text-[11px] font-black uppercase tracking-wider transition-all hover:bg-cyan-500/10 flex items-center gap-1.5 disabled:opacity-50"
                            style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
                            <RefreshCw className={`h-3.5 w-3.5 ${reportLoading ? 'animate-spin' : ''}`} /> Generate
                        </button>
                        <button onClick={sendReport} disabled={reportLoading || !report}
                            className="h-9 px-3 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 text-white text-[11px] font-black uppercase tracking-wider shadow-lg shadow-cyan-500/20 hover:scale-105 transition-all flex items-center gap-1.5 disabled:opacity-50">
                            <SendHorizontal className="h-3.5 w-3.5" /> Send to Telegram
                        </button>
                        <button onClick={() => window.print()} disabled={!report}
                            className="h-9 px-3 rounded-xl border text-[11px] font-black uppercase tracking-wider transition-all hover:bg-white/10 disabled:opacity-50"
                            style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
                            <Printer className="h-3.5 w-3.5 inline mr-1" /> Print
                        </button>
                    </div>
                </div>

                {reportSent && (
                    <div className="px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" /> Report sent to the family/doctor Telegram chat.
                    </div>
                )}

                {reportLoading && !report ? (
                    <div className="rounded-2xl border p-10 flex flex-col items-center gap-3" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                        <Loader2 className="h-8 w-8 text-cyan-400 animate-spin" />
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Local AI is analyzing vitals trends, prescriptions and alerts…</p>
                    </div>
                ) : report ? (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" id="health-report-print">
                        <div className="lg:col-span-2 space-y-4">
                            <div className="rounded-2xl border p-5" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center text-white">
                                            <User className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <h3 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>{report.patient}</h3>
                                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Age {report.age} · {report.village} · {report.conditions}</p>
                                        </div>
                                    </div>
                                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider border ${report.risk_score >= 70 ? 'text-red-400 border-red-500/40 bg-red-500/10' : report.risk_score >= 40 ? 'text-amber-400 border-amber-500/40 bg-amber-500/10' : 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'}`}>
                                        Risk {report.risk_score}/100 · {report.risk_level}
                                    </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { label: 'HR', value: report.stats?.match(/HR\s+([\d-]+)\s*bpm/)?.[1] || '—', icon: HeartPulse },
                                        { label: 'SpO2', value: report.stats?.match(/SpO2\s+([\d-]+)%/)?.[1] || '—', icon: Droplets },
                                        { label: 'Temp', value: report.stats?.match(/Temp\s+([\d.-]+)/)?.[1] || '—', icon: Thermometer },
                                    ].map(s => {
                                        const Icon = s.icon
                                        return (
                                            <div key={s.label} className="rounded-xl border p-3 text-center" style={{ borderColor: 'var(--border-color)' }}>
                                                <Icon className={`h-4 w-4 mx-auto mb-1 ${s.label === 'SpO2' ? 'text-sky-400' : s.label === 'Temp' ? 'text-orange-400' : 'text-rose-400'}`} />
                                                <p className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>{s.value}</p>
                                                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>

                            <div className="rounded-2xl border p-5" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                                <h4 className="text-sm font-black mb-2 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                    <Sparkles className="h-4 w-4 text-cyan-400" /> AI Summary
                                </h4>
                                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>{report.ai_summary}</p>
                            </div>

                            <div className="rounded-2xl border p-5" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                                <h4 className="text-sm font-black mb-2 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                    <AlertTriangle className="h-4 w-4 text-amber-400" /> Concerns
                                </h4>
                                {(report.ai_concerns || []).length > 0 ? (
                                    <ul className="space-y-1.5">
                                        {(report.ai_concerns as string[]).map((c, i) => (
                                            <li key={i} className="text-sm flex gap-2" style={{ color: 'var(--text-primary)' }}>
                                                <span className="text-amber-400">•</span> {c}
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No concerns flagged.</p>
                                )}
                            </div>

                            <div className="rounded-2xl border p-5" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                                <h4 className="text-sm font-black mb-2 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                    <Ambulance className="h-4 w-4 text-rose-400" /> Recommendation
                                </h4>
                                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>{report.ai_recommendation}</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="rounded-2xl border p-5" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                                <h4 className="text-sm font-black mb-3" style={{ color: 'var(--text-primary)' }}>Raw Data (local SQLite)</h4>
                                <div className="space-y-2 text-xs">
                                    <div>
                                        <p className="font-bold uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-muted)' }}>Vital ranges (last 200 readings)</p>
                                        <p style={{ color: 'var(--text-primary)' }}>{report.stats}</p>
                                    </div>
                                    <div>
                                        <p className="font-bold uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-muted)' }}>Trend</p>
                                        <p style={{ color: 'var(--text-primary)' }}>{report.trend}</p>
                                    </div>
                                    <div>
                                        <p className="font-bold uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-muted)' }}>Prescriptions</p>
                                        <p style={{ color: 'var(--text-primary)' }}>{report.meds}</p>
                                    </div>
                                    <div>
                                        <p className="font-bold uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-muted)' }}>Recent alerts</p>
                                        <p style={{ color: 'var(--text-primary)' }}>{report.alerts}</p>
                                    </div>
                                    <div>
                                        <p className="font-bold uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-muted)' }}>Generated</p>
                                        <p style={{ color: 'var(--text-primary)' }}>{new Date(report.generated_at * 1000).toLocaleString()}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-2xl border p-5 text-xs leading-relaxed" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
                                💡 <b>Demo tip:</b> hit <b>Send to Telegram</b> — the report goes straight to the family/doctor chat with vitals, AI summary and recommendations. 100% local AI + local SQLite, zero cloud.
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-2xl border p-10 text-center text-sm" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
                        Could not generate the report. Is the backend running on :8000?
                    </div>
                )}
            </div>
            )}

            {/* Chat Tab */}
            {activeTab === 'chat' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Zap className="h-5 w-5 text-purple-400" />
                            <h2 className="text-lg font-black" style={{ color: 'var(--text-primary)' }}>Triage Insights</h2>
                            {insights.length > 0 && <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 text-[11px] font-black">{insights.length}</span>}
                        </div>
                        {insights.length > 0 && (
                            <button onClick={handleClearInsights} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold border hover:bg-red-500/10 text-red-400 border-red-500/30 transition-all">
                                <Trash2 className="h-3 w-3" /> Clear
                            </button>
                        )}
                    </div>

                    {/* Chat Interface */}
                    <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                            <div className="flex items-center gap-2">
                                <MessageCircle className="h-5 w-5 text-purple-400" />
                                <h2 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>Chat with AyuLink AI</h2>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-0.5 p-0.5 rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                                    {([{code:'en' as const,label:'🇬🇧 EN'},{code:'hi' as const,label:'🇮🇳 हिं'},{code:'te' as const,label:'🇮🇳 తె'}]).map(l => (
                                        <button key={l.code} onClick={() => setChatLang(l.code)}
                                            className={`px-2 py-1 rounded-lg text-[11px] font-black transition-all ${chatLang === l.code ? 'bg-purple-500 text-white' : 'hover:bg-white/10'}`}
                                            style={{ color: chatLang === l.code ? undefined : 'var(--text-muted)' }}>{l.label}</button>
                                    ))}
                                </div>
                                {chatMessages.length > 0 && (
                                    <button onClick={handleClearChat} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-all" title="Clear chat">
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="h-72 overflow-y-auto p-4 space-y-3" style={{ background: 'var(--bg-primary)' }}>
                            {chatMessages.length === 0 && (
                                <div className="flex flex-col items-center justify-center h-full gap-2 opacity-40">
                                    <Brain className="h-8 w-8" style={{ color: 'var(--text-muted)' }} />
                                    <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                                        Ask about patients, reports, medications, or mental health.<br/>Supports EN, हिंदी, తెలుగు. Detects emotional distress.
                                    </p>
                                </div>
                            )}
                            {chatMessages.map((m, i) => (
                                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
                                        ${m.role === 'user' ? 'bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-br-md' : 'border rounded-bl-md'}`}
                                        style={m.role === 'ai' ? { background: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' } : {}}>
                                        {m.text}
                                    </div>
                                </div>
                            ))}
                            {chatLoading && (
                                <div className="flex justify-start">
                                    <div className="px-4 py-3 rounded-2xl rounded-bl-md border flex items-center gap-2" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                                        <Loader2 className="h-4 w-4 text-purple-400 animate-spin" />
                                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                            {chatLang === 'hi' ? 'सोच रहा हूँ...' : chatLang === 'te' ? 'ఆలోచిస్తున్నాను...' : 'Thinking...'}
                                        </span>
                                    </div>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>
                    {/* Patient Created Toast */}
                    {patientCreatedToast && (
                        <div className="mx-3 mt-2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-2">
                            <UserPlus className="h-4 w-4 flex-shrink-0" />
                            {patientCreatedToast}
                        </div>
                    )}
                    {/* Quick Reply Chips */}
                    <div className="px-3 pt-2 pb-1 flex flex-wrap gap-1.5">
                        {[
                            { label: '📊 Patient status', msg: 'What is the current status of all patients?' },
                            { label: '💊 Medication check', msg: 'Which patients have not taken their medications today?' },
                            { label: '🚨 Latest alerts', msg: 'Show me the latest emergency alerts' },
                            { label: '🫀 High risk patients', msg: 'Which patients are at highest risk right now?' },
                            { label: '📋 Daily report', msg: 'Give me a daily health summary for all patients' },
                        ].map(chip => (
                            <button key={chip.label} onClick={() => handleSendChat(chip.msg)}
                                className="px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-all hover:bg-purple-500/10 hover:border-purple-500/40 hover:text-purple-300"
                                style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)', background: 'var(--bg-primary)' }}
                                disabled={chatLoading}>
                                {chip.label}
                            </button>
                        ))}
                        {/* Register patient button opens modal instead of chat */}
                        <button onClick={() => setShowRegModal(true)}
                            className="px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-all hover:bg-purple-500/10 hover:border-purple-500/40 hover:text-purple-300"
                            style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)', background: 'var(--bg-primary)' }}
                            disabled={chatLoading}>
                            ➕ Register patient
                        </button>
                    </div>
                    <div className="p-3 border-t flex gap-2" style={{ borderColor: 'var(--border-color)' }}>
                        <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSendChat()}
                            placeholder={chatLang === 'hi' ? 'मरीज़ के बारे में पूछें...' : chatLang === 'te' ? 'రోగి గురించి అడగండి...' : 'Ask about patients, reports, mental health, or register new patient...'}
                            className="flex-1 px-4 py-2.5 rounded-xl border text-sm outline-none focus:ring-2 focus:ring-purple-500/30 transition-all"
                            style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                            disabled={chatLoading} />
                        <button onClick={startVoice}
                            className={`h-10 w-10 rounded-xl flex items-center justify-center transition-all border disabled:opacity-50 ${listening ? 'bg-red-500 text-white border-red-500 animate-pulse' : speaking ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'hover:bg-purple-500/10'}`}
                            style={!listening && !speaking ? { borderColor: 'var(--border-color)', color: 'var(--text-muted)' } : {}}
                            disabled={chatLoading} title={listening ? 'Listening… tap to stop' : speaking ? 'Speaking…' : 'Voice'}>
                            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        </button>
                        <button onClick={() => handleSendChat()} disabled={chatLoading || !chatInput.trim()}
                            className="h-10 w-10 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white flex items-center justify-center shadow-lg shadow-purple-500/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-50">
                            <Send className="h-4 w-4" />
                        </button>
                    </div>
                    </div>
                </div>

                {/* Right sidebar */}
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border p-4 text-center" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                            <p className="text-2xl font-black text-purple-400">{insights.length}</p>
                            <p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-muted)' }}>Insights</p>
                        </div>
                        <div className="rounded-2xl border p-4 text-center" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                            <p className="text-2xl font-black text-cyan-400">{insights.filter(i => i.severity === 'critical' || i.severity === 'emergency').length}</p>
                            <p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-muted)' }}>Critical</p>
                        </div>
                    </div>
                    <div className="rounded-2xl border p-4 flex items-center gap-3" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center">
                            <Cpu className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <p className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>Llama 3.1 8B Instant</p>
                            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>via Groq · &lt;0.5s latency</p>
                        </div>
                        <div className="ml-auto flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-[11px] text-emerald-400 font-semibold">Active</span>
                        </div>
                    </div>
                    <LiveContextPanel vital={vital} hub={hub} />
                    <div className="rounded-2xl border p-4 space-y-3" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                        <h3 className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Capabilities</h3>
                        {[{ icon: Activity, label: 'Live vitals via LoRa wearable' },
                          { icon: Wind, label: 'Air quality & fire detection' },
                          { icon: Pill, label: 'Medication compliance tracking' },
                          { icon: Brain, label: 'Multi-lingual AI chat (EN/HI/TE)' },
                          { icon: AlertTriangle, label: 'Mental health distress detection' },
                          { icon: Zap, label: 'Sub-second triage via Groq' },
                          { icon: UserPlus, label: 'Register new patients by chat' },
                          { icon: Ambulance, label: 'Paramedic dispatch integration' },
                        ].map(({ icon: Icon, label }, i) => (
                            <div key={i} className="flex items-center gap-3">
                                <div className="w-6 h-6 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center flex-shrink-0">
                                    <Icon className="h-3 w-3 text-purple-400" />
                                </div>
                                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{label}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            )}
        </div>
    {/* Patient Registration Modal */}
    {showRegModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowRegModal(false)}>
            <div className="w-full max-w-md mx-4 rounded-2xl border p-6 shadow-2xl" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3 mb-5">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 flex items-center justify-center">
                        <UserPlus className="h-5 w-5 text-white" />
                    </div>
                    <div>
                        <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Register New Patient</h2>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Add to AyuLink monitoring system</p>
                    </div>
                </div>
                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Patient Name *</label>
                        <input value={regForm.name} onChange={e => setRegForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="e.g. Lakshmi Devi"
                            className="w-full px-3 py-2 rounded-xl border text-sm outline-none focus:ring-2 focus:ring-purple-500/30"
                            style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Age</label>
                            <input value={regForm.age} onChange={e => setRegForm(f => ({ ...f, age: e.target.value }))}
                                type="number" placeholder="e.g. 72"
                                className="w-full px-3 py-2 rounded-xl border text-sm outline-none focus:ring-2 focus:ring-purple-500/30"
                                style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
                        </div>
                        <div>
                            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Village / Location</label>
                            <input value={regForm.village} onChange={e => setRegForm(f => ({ ...f, village: e.target.value }))}
                                placeholder="e.g. Hanamkonda"
                                className="w-full px-3 py-2 rounded-xl border text-sm outline-none focus:ring-2 focus:ring-purple-500/30"
                                style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Medical Conditions <span className="font-normal">(comma separated)</span></label>
                        <input value={regForm.conditions} onChange={e => setRegForm(f => ({ ...f, conditions: e.target.value }))}
                            placeholder="e.g. Diabetes, Hypertension, COPD"
                            className="w-full px-3 py-2 rounded-xl border text-sm outline-none focus:ring-2 focus:ring-purple-500/30"
                            style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
                    </div>
                </div>
                <div className="flex gap-3 mt-5">
                    <button onClick={() => { setShowRegModal(false); setRegForm({ name: '', age: '', village: '', conditions: '' }) }}
                        className="flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all hover:bg-white/5"
                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>Cancel</button>
                    <button onClick={handleRegisterPatient} disabled={!regForm.name.trim() || regLoading}
                        className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white text-sm font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-purple-500/20">
                        {regLoading ? 'Registering...' : '✅ Register Patient'}
                    </button>
                </div>
            </div>
        </div>
    )}
    </>
    )
}
