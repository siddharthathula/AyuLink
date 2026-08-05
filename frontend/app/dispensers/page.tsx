'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
    Radio, Wifi, WifiOff, Pill, Clock, CheckCircle, AlertCircle,
    Battery, BatteryLow, BatteryCharging, X, Activity, TrendingUp,
    MapPin, Signal, Zap, RefreshCw, ChevronRight, Package,
    ShieldCheck, AlertTriangle, CircleDot, Timer, Loader2,
    Cpu, RotateCcw, Play, CheckSquare, Square, Bluetooth,
    Wind, Flame, Camera, Video, Thermometer, Droplets
} from 'lucide-react'

import MedicineCompliance from '@/components/MedicineCompliance'
import MedicineScheduleManager from '@/components/MedicineScheduleManager'
import { useDemoMode } from '@/lib/demo-context'
import { useTheme } from '@/lib/theme-context'

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface Dispenser {
    id: string
    patient: string
    location: string
    status: 'online' | 'offline'
    battery: number
    lastSync: string
    slots: number
    filled: number
    nextDose?: string
    compliance?: number
}

interface HubSlotState {
    slot: number
    label: string          // Morning / Afternoon / Evening / Night
    angle: number          // servo degrees
    taken: boolean
    time: string           // dispense time
}

interface HubLiveState {
    connected: boolean
    deviceId: string
    rssi: number
    uptime: number
    slots: HubSlotState[]
    lastUpdate: number     // timestamp ms
}

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const SLOT_DEFAULTS: HubSlotState[] = [
    { slot: 1, label: 'Morning',   angle: 0,   taken: false, time: '08:00 AM' },
    { slot: 2, label: 'Afternoon', angle: 60,  taken: false, time: '01:00 PM' },
    { slot: 3, label: 'Evening',   angle: 120, taken: false, time: '06:00 PM' },
    { slot: 4, label: 'Night',     angle: 180, taken: false, time: '10:00 PM' },
]

// ── Python backend WebSocket (primary) ──
// Dashboard connects to /ws/dashboard and sends {"action":"dispense","slot":N}

const DASHBOARD_WS_URL =
    typeof window !== 'undefined'
        ? `ws://${window.location.hostname}:8000/ws/dashboard`
        : 'ws://localhost:8000/ws/dashboard'

const demoDispensers: Dispenser[] = [
    { id: 'MB-001', patient: 'Ramulu Goud',     location: 'Hanamkonda',      status: 'online',  battery: 100, lastSync: '2 min ago',  slots: 4, filled: 4, nextDose: '14:00', compliance: 95 },
]

// ─────────────────────────────────────────────────────────────
// HELPER COMPONENTS
// ─────────────────────────────────────────────────────────────

function BatteryIndicator({ level }: { level: number }) {
    const color   = level <= 15 ? 'text-red-500' : level <= 40 ? 'text-amber-500' : 'text-emerald-500'
    const bgColor = level <= 15 ? 'bg-red-500' : level <= 40 ? 'bg-amber-500' : 'bg-emerald-500'
    return (
        <div className="flex items-center gap-2">
            <div className="relative w-10 h-5 rounded-sm border-2 border-current opacity-60" style={{ color: 'var(--text-muted)' }}>
                <div className="absolute right-[-4px] top-[4px] w-[3px] h-[8px] rounded-r-sm bg-current opacity-40" />
                <div className={`absolute left-[2px] top-[2px] bottom-[2px] rounded-[1px] transition-all ${bgColor}`}
                    style={{ width: `${Math.max(4, (level / 100) * 85)}%` }} />
            </div>
            <span className={`text-xs font-bold ${color}`}>{level}%</span>
        </div>
    )
}

function SlotVisualizer({ total, filled }: { total: number, filled: number }) {
    return (
        <div className="flex items-center gap-1.5">
            {Array.from({ length: total }, (_, i) => (
                <div key={i} className={`w-3 h-3 rounded-full transition-all ${i < filled
                    ? 'bg-purple-500 shadow-sm shadow-purple-500/40'
                    : 'bg-gray-200 dark:bg-slate-700'}`} />
            ))}
        </div>
    )
}

function ComplianceRing({ value, size = 44 }: { value: number, size?: number }) {
    const radius = (size - 6) / 2
    const circumference = 2 * Math.PI * radius
    const offset = circumference - (value / 100) * circumference
    const color = value >= 90 ? '#10b981' : value >= 70 ? '#f59e0b' : '#ef4444'
    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
                <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border-color)" strokeWidth="3" />
                <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
                    stroke={color} strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={circumference} strokeDashoffset={offset}
                    className="transition-all duration-700" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[10px] font-bold" style={{ color }}>{value}%</span>
            </div>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────
// ESP32-S3 LIVE HUB CONTROL PANEL
// ─────────────────────────────────────────────────────────────

function ESP32HubPanel() {
    const [hubState, setHubState] = useState<HubLiveState>({
        connected: false,
        deviceId: 'ESP32-S3-PILL',
        rssi: 0,
        uptime: 0,
        slots: SLOT_DEFAULTS,
        lastUpdate: 0,
    })
    const [dispensing, setDispensing] = useState<number | null>(null)   // which slot is being dispensed
    const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' | 'info' } | null>(null)
    const [envData, setEnvData] = useState({
        air_ppm: 0, air_aqi: 'Good', flame: false,
        env_temp: 0.0, humidity: 0.0,           // DHT11
        rtc_time: '', rtc_date: '',              // DS3231 RTC
    })
    const [camUrl, setCamUrl] = useState<string>('/api/stream')
    const [camConnected, setCamConnected] = useState(false)
    const wsRef  = useRef<WebSocket | null>(null)
    const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const showToast = (msg: string, type: 'ok' | 'err' | 'info' = 'ok') => {
        setToast({ msg, type })
        setTimeout(() => setToast(null), 3500)
    }

    // ── Connect to backend WS (which relays to ESP32) ──
    const connect = useCallback(() => {
        if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
            // Vercel / HTTPS mode: Enable cloud simulation mode without throwing WS errors
            setHubState(prev => ({ ...prev, connected: true }))
            return
        }

        try {
            const wsUrl = typeof window !== 'undefined'
                ? `ws://${window.location.hostname}:8000/ws/dashboard`
                : 'ws://localhost:8000/ws/dashboard'

            const ws = new WebSocket(wsUrl)

            ws.onopen = () => {
                setHubState(prev => ({ ...prev, connected: true }))
                showToast('Connected to AyuLink Agent', 'ok')
                if (retryRef.current) clearTimeout(retryRef.current)
            }

            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data)

                    // Hub data event from backend
                    if (msg.event === 'hub' || msg.event === 'state') {
                        const d = msg.event === 'hub' ? msg.data : msg.data?.hub
                        if (!d) return

                        setHubState(prev => ({
                            ...prev,
                            connected: d.online !== false,
                            rssi: d.rssi ?? prev.rssi,
                            uptime: d.uptime ?? prev.uptime,
                            lastUpdate: Date.now(),
                            slots: SLOT_DEFAULTS.map((s, i) => ({
                                ...s,
                                taken: [d.pill_slot1, d.pill_slot2, d.pill_slot3, d.pill_slot4][i] ?? s.taken,
                            }))
                        }))
                        // Also update env data — compute air quality label from PPM
                        const ppm = d.air_ppm ?? 0
                        const aqLabel = ppm > 300 ? 'Danger' : ppm > 150 ? 'Poor' : ppm > 50 ? 'Moderate' : 'Good'
                        setEnvData({
                            air_ppm: ppm,
                            air_aqi: aqLabel,
                            flame: d.flame ?? false,
                            env_temp: d.env_temp ?? 0,
                            humidity: d.humidity ?? 0,
                            rtc_time: d.rtc_time ?? '',
                            rtc_date: d.rtc_date ?? '',
                        })
                        // Cache last known temp/humidity in localStorage
                        if (d.env_temp > 0) localStorage.setItem('ayulink_last_env_temp', String(d.env_temp))
                        if (d.humidity > 0) localStorage.setItem('ayulink_last_humidity', String(d.humidity))
                    }

                    // Hub status (connected/disconnected)
                    if (msg.event === 'hub_status') {
                        setHubState(prev => ({ ...prev, connected: msg.data?.connected ?? prev.connected }))
                        if (msg.data?.connected) showToast('ESP32-S3 Dispenser Online!', 'ok')
                        else showToast('ESP32-S3 Dispenser Offline', 'err')
                    }
                } catch { /* ignore */ }
            }

            ws.onclose = () => {
                setHubState(prev => ({ ...prev, connected: false }))
                if (typeof window !== 'undefined' && window.location.protocol !== 'https:') {
                    retryRef.current = setTimeout(connect, 6000)
                }
            }
            ws.onerror = () => ws.close()
            wsRef.current = ws

        } catch {
            if (typeof window !== 'undefined' && window.location.protocol !== 'https:') {
                retryRef.current = setTimeout(connect, 6000)
            }
        }
    }, [])

    useEffect(() => {
        connect()
        // Fetch camera URL
        // The backend automatically proxies the camera feed to /api/stream
        return () => {
            wsRef.current?.close()
            if (retryRef.current) clearTimeout(retryRef.current)
        }
    }, [connect])

    // ── DISPENSE action: send cmd to backend → relayed to ESP32 ──
    const handleDispense = async (slot: number) => {
        if (dispensing !== null) return

        const alreadyTaken = hubState.slots[slot - 1]?.taken
        if (alreadyTaken) {
            showToast(`Slot ${slot} already dispensed today`, 'err')
            return
        }

        setDispensing(slot)
        showToast(`Dispensing Slot ${slot} (${SLOT_DEFAULTS[slot - 1].label})...`, 'info')

        try {
            // 1. REST API call (primary path — goes through Python backend to ESP32)
            const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
            const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
            const endpoint = isHttps ? `/api/dispense/${slot}` : `http://${host}:8000/api/dispense/${slot}`

            const res = await fetch(endpoint, { method: 'POST' })
                .catch(() => null)

            if (res?.ok) {
                const data = await res.json()
                if (data.ok) {
                    setHubState(prev => ({
                        ...prev,
                        slots: prev.slots.map(s => s.slot === slot ? { ...s, taken: true } : s)
                    }))
                    showToast(`✓ Slot ${slot} dispensed!`, 'ok')
                } else {
                    showToast(`Error: ${data.error || 'Hub not connected'}`, 'err')
                }
            } else {
                // Fallback for Vercel / Cloud Demo Mode
                setHubState(prev => ({
                    ...prev,
                    slots: prev.slots.map(s => s.slot === slot ? { ...s, taken: true } : s)
                }))
                showToast(`✓ Slot ${slot} dispensed (Simulated Demo)`, 'ok')
            }
        } catch {
            setHubState(prev => ({
                ...prev,
                slots: prev.slots.map(s => s.slot === slot ? { ...s, taken: true } : s)
            }))
            showToast(`✓ Slot ${slot} dispensed (Simulated Demo)`, 'ok')
        } finally {
            setTimeout(() => setDispensing(null), 2500)
        }
    }

    // ── RESET a slot ──
    const handleReset = async (slot: number) => {
        try {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ action: 'dispense', slot, reset: true }))
            }
            setHubState(prev => ({
                ...prev,
                slots: prev.slots.map(s => s.slot === slot ? { ...s, taken: false } : s)
            }))
            showToast(`Slot ${slot} reset`, 'info')
        } catch { showToast('Reset failed', 'err') }
    }

    // ── RESET ALL ──
    const handleResetAll = () => {
        setHubState(prev => ({
            ...prev,
            slots: prev.slots.map(s => ({ ...s, taken: false }))
        }))
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: 'reset_all' }))
        }
        showToast('All slots reset for today', 'info')
    }

    const takenCount = hubState.slots.filter(s => s.taken).length
    const compliancePct = Math.round((takenCount / 4) * 100)

    return (
        <div className="rounded-3xl border-2 overflow-hidden"
            style={{ borderColor: hubState.connected ? 'rgb(168 85 247 / 0.5)' : 'var(--border-color)', background: 'var(--bg-secondary)' }}>

            {/* ── Header ── */}
            <div className="px-6 py-5 border-b flex items-center justify-between"
                style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}>
                <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg ${hubState.connected
                        ? 'bg-gradient-to-br from-purple-600 to-pink-500 shadow-purple-500/20'
                        : 'bg-gray-200 dark:bg-slate-700'}`}>
                        <Cpu className={`h-6 w-6 ${hubState.connected ? 'text-white' : 'text-gray-400'}`} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-black text-base" style={{ color: 'var(--text-primary)' }}>
                                NodeMCU Smart Dispenser Hub
                            </h3>
                            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${hubState.connected
                                ? 'bg-emerald-500/10 text-emerald-500'
                                : 'bg-red-500/10 text-red-500'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${hubState.connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                                {hubState.connected ? 'LIVE' : 'OFFLINE'}
                            </span>
                        </div>
                        <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            {hubState.connected
                                ? `${hubState.deviceId} · RSSI ${hubState.rssi} dBm · ↑${Math.floor(hubState.uptime / 60)}m`
                                : 'Connecting to AyuLink backend...'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* Compliance ring */}
                    <div className="text-center">
                        <ComplianceRing value={compliancePct} size={48} />
                        <p className="text-[9px] font-bold mt-0.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Today</p>
                    </div>
                    <button onClick={handleResetAll}
                        title="Reset all slots for today"
                        className="w-9 h-9 rounded-xl border flex items-center justify-center transition-all hover:bg-red-50 dark:hover:bg-red-900/10 hover:text-red-500 hover:border-red-300"
                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
                        <RotateCcw className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* ── 4-Slot Grid ── */}
            <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3">
                {hubState.slots.map(slot => {
                    const isDispensing = dispensing === slot.slot
                    const isTaken     = slot.taken

                    return (
                        <div key={slot.slot}
                            className={`relative rounded-2xl border-2 p-4 flex flex-col gap-3 transition-all duration-300
                                ${isTaken
                                    ? 'border-emerald-400/60 dark:border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-900/10'
                                    : isDispensing
                                        ? 'border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/10 animate-pulse'
                                        : 'border-purple-200 dark:border-purple-900/40 hover:border-purple-400 dark:hover:border-purple-500/60'}`}
                            style={{ background: isTaken || isDispensing ? undefined : 'var(--bg-primary)' }}>

                            {/* Slot number badge */}
                            <div className="flex items-center justify-between">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black
                                    ${isTaken ? 'bg-emerald-500 text-white'
                                        : isDispensing ? 'bg-blue-500 text-white'
                                            : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'}`}>
                                    {isDispensing
                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                        : isTaken
                                            ? <CheckCircle className="h-4 w-4" />
                                            : slot.slot}
                                </div>

                                {/* Status dot */}
                                <div className={`w-2 h-2 rounded-full ${isTaken ? 'bg-emerald-500'
                                    : isDispensing ? 'bg-blue-500 animate-ping'
                                        : 'bg-gray-300 dark:bg-slate-600'}`} />
                            </div>

                            {/* Info */}
                            <div>
                                <p className="font-black text-sm" style={{ color: 'var(--text-primary)' }}>{slot.label}</p>
                                <div className="flex items-center gap-1 mt-0.5">
                                    <Clock className="h-3 w-3" style={{ color: 'var(--text-muted)' }} />
                                    <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{slot.time}</span>
                                </div>
                                <p className="text-[10px] mt-1 font-mono opacity-50" style={{ color: 'var(--text-muted)' }}>
                                    Servo: {slot.angle}°
                                </p>
                            </div>

                            {/* Status label */}
                            <div className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg text-center
                                ${isTaken ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                    : isDispensing ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                        : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400'}`}>
                                {isTaken ? '✓ Taken' : isDispensing ? 'Dispensing...' : 'Pending'}
                            </div>

                            {/* DISPENSE / RESET buttons */}
                            <div className="flex gap-1.5">
                                {!isTaken ? (
                                    <button
                                        onClick={() => handleDispense(slot.slot)}
                                        disabled={isDispensing || dispensing !== null}
                                        className="flex-1 h-9 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white text-[11px] font-black uppercase tracking-wide
                                            flex items-center justify-center gap-1
                                            hover:shadow-lg hover:shadow-purple-500/30 hover:scale-[1.03]
                                            active:scale-[0.97] transition-all
                                            disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100">
                                        {isDispensing
                                            ? <Loader2 className="h-3 w-3 animate-spin" />
                                            : <Play className="h-3 w-3" />}
                                        {isDispensing ? 'Wait' : 'Dispense'}
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => handleReset(slot.slot)}
                                        className="flex-1 h-9 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400
                                            text-[11px] font-black uppercase tracking-wide
                                            flex items-center justify-center gap-1
                                            hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-all">
                                        <RotateCcw className="h-3 w-3" />
                                        Reset
                                    </button>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* ── Environment Sensors ── */}
            <div className="px-5 pb-3 grid grid-cols-2 md:grid-cols-3 gap-3">
                {/* MQ-135 Air Quality */}
                <div className={`rounded-xl p-3 border ${envData.air_ppm > 500 ? 'border-red-500/40 bg-red-500/10' : envData.air_ppm > 300 ? 'border-amber-500/40 bg-amber-500/10' : 'border-emerald-500/30 bg-emerald-500/10'}`}>
                    <div className="flex items-center gap-2 mb-1">
                        <Wind className={`h-4 w-4 ${envData.air_ppm > 500 ? 'text-red-400' : envData.air_ppm > 300 ? 'text-amber-400' : 'text-emerald-400'}`} />
                        <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Air Quality (MQ-135)</span>
                    </div>
                    <p className="text-lg font-black" style={{ color: 'var(--text-primary)' }}>{envData.air_ppm} PPM</p>
                    <p className={`text-[10px] font-bold ${envData.air_aqi === 'Danger' ? 'text-red-400' : envData.air_aqi === 'Poor' ? 'text-amber-400' : 'text-emerald-400'}`}>{envData.air_aqi}</p>
                </div>

                {/* Flame Sensor */}
                <div className={`rounded-xl p-3 border ${envData.flame ? 'border-red-500/60 bg-red-500/20 animate-pulse' : 'border-emerald-500/30 bg-emerald-500/10'}`}>
                    <div className="flex items-center gap-2 mb-1">
                        <Flame className={`h-4 w-4 ${envData.flame ? 'text-red-400' : 'text-emerald-400'}`} />
                        <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Flame Sensor</span>
                    </div>
                    <p className={`text-lg font-black ${envData.flame ? 'text-red-400' : 'text-emerald-400'}`}>{envData.flame ? '🔥 FIRE' : '✓ Clear'}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{envData.flame ? 'Alert active!' : 'No detection'}</p>
                </div>

                {/* DHT11 Room Temperature */}
                <div className="rounded-xl p-3 border" style={{ borderColor: 'rgba(251,146,60,0.3)', background: 'rgba(251,146,60,0.08)' }}>
                    <div className="flex items-center gap-2 mb-1">
                        <Thermometer className="h-4 w-4 text-orange-400" />
                        <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Room Temp (DHT11)</span>
                    </div>
                    <p className="text-lg font-black text-orange-400">
                        {envData.env_temp > 0 ? `${envData.env_temp.toFixed(1)}°C` : (() => { const cached = typeof window !== 'undefined' ? localStorage.getItem('ayulink_last_env_temp') : null; return cached ? `${parseFloat(cached).toFixed(1)}°C` : 'No signal' })()}
                    </p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{envData.env_temp > 0 ? 'Ambient temperature' : 'Hub offline — last cached'}</p>
                </div>

                {/* DHT11 Humidity */}
                <div className="rounded-xl p-3 border" style={{ borderColor: 'rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.08)' }}>
                    <div className="flex items-center gap-2 mb-1">
                        <Droplets className="h-4 w-4 text-blue-400" />
                        <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Humidity (DHT11)</span>
                    </div>
                    <p className="text-lg font-black text-blue-400">
                        {envData.humidity > 0 ? `${envData.humidity.toFixed(1)}%` : (() => { const cached = typeof window !== 'undefined' ? localStorage.getItem('ayulink_last_humidity') : null; return cached ? `${parseFloat(cached).toFixed(1)}%` : 'No signal' })()}
                    </p>
                    <p className={`text-[10px] font-bold ${
                        envData.humidity > 70 ? 'text-amber-400' : envData.humidity < 30 ? 'text-red-400' : 'text-emerald-400'
                    }`}>
                        {envData.humidity > 70 ? 'High — risk of mold' : envData.humidity < 30 ? 'Low — dry air' : 'Comfortable'}
                    </p>
                </div>

                {/* DS3231 RTC */}
                <div className="rounded-xl p-3 border" style={{ borderColor: 'rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.08)' }}>
                    <div className="flex items-center gap-2 mb-1">
                        <Clock className="h-4 w-4 text-violet-400" />
                        <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>RTC Clock (DS3231)</span>
                    </div>
                    <p className="text-lg font-black text-violet-400">
                        {envData.rtc_time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {envData.rtc_date || new Date().toLocaleDateString()} · Precise I²C RTC
                    </p>
                </div>

                {/* ── Camera Feed ── */}
                <div className="rounded-xl p-3 border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}>
                    <div className="flex justify-center">
                        <div className="relative rounded-xl overflow-hidden bg-black flex items-center justify-center" style={{ height: 240, width: 320, border: '1px solid var(--border-color)' }}>
                            <img 
                                key={camUrl}
                                src={camUrl}
                                alt="Live Stream"
                                className="w-full h-full object-contain opacity-90"
                                onLoad={() => setCamConnected(true)}
                                onError={(e) => {
                                    setCamConnected(false);
                                    e.currentTarget.style.display = 'none';
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Footer: progress bar ── */}
            <div className="px-5 pb-5">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
                        Daily Compliance
                    </span>
                    <span className="text-xs font-black" style={{ color: 'var(--text-primary)' }}>
                        {takenCount}/4 doses taken
                    </span>
                </div>
                <div className="w-full h-2 rounded-full overflow-hidden bg-gray-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-pink-500 transition-all duration-700"
                        style={{ width: `${compliancePct}%` }} />
                </div>
            </div>

            {/* ── Toast ── */}
            {toast && (
                <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-sm font-bold shadow-xl z-50
                    flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200
                    ${toast.type === 'ok' ? 'bg-emerald-500 text-white'
                        : toast.type === 'err' ? 'bg-red-500 text-white'
                            : 'bg-blue-500 text-white'}`}>
                    {toast.type === 'ok' && <CheckCircle className="h-4 w-4" />}
                    {toast.type === 'err' && <AlertCircle className="h-4 w-4" />}
                    {toast.type === 'info' && <Loader2 className="h-4 w-4 animate-spin" />}
                    {toast.msg}
                </div>
            )}
        </div>
    )
}

// ─────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────

export default function DispensersPage() {
    const { t } = useTheme()
    const { isDemoMode } = useDemoMode()
    const [dispensers, setDispensers] = useState<Dispenser[]>([])
    const [loading, setLoading] = useState(true)
    const [showMedicineManager, setShowMedicineManager] = useState(false)
    const [selectedDispenser, setSelectedDispenser] = useState<Dispenser | null>(null)
    const [stats, setStats] = useState({ compliance: 85, doses: 24, taken: 20 })
    const [refreshing, setRefreshing] = useState(false)

    useEffect(() => {
        if (isDemoMode) {
            setDispensers(demoDispensers)
            setStats({ compliance: 85, doses: 24, taken: 20 })
            setLoading(false)
            return
        }

        // ── Real mode: fetch from local SQLite backend ──
        const fetchData = async () => {
            setLoading(true)
            try {
                const res = await fetch('/api/patients')
                const data = await res.json()
                if (data.ok && data.patients) {
                    const formatted: Dispenser[] = data.patients.map((p: any) => ({
                        id: p.id,
                        patient: p.name,
                        location: p.village || 'Unknown',
                        status: (p.device_status === 'offline' ? 'offline' : 'online') as 'online' | 'offline',
                        battery: 100,
                        lastSync: 'Live',
                        slots: 4,
                        filled: 3,
                        nextDose: '—',
                        compliance: 85
                    }))
                    setDispensers(formatted.length > 0 ? formatted : demoDispensers)
                } else {
                    setDispensers(demoDispensers)
                }
            } catch {
                setDispensers(demoDispensers)
            } finally {
                setLoading(false)
            }
        }

        fetchData()
        const id = setInterval(fetchData, 30000)
        return () => clearInterval(id)
    }, [isDemoMode])

    const onlineCount   = dispensers.filter(d => d.status === 'online').length
    const offlineCount  = dispensers.filter(d => d.status === 'offline').length
    const lowBattery    = dispensers.filter(d => d.battery < 20).length
    const avgCompliance = dispensers.length > 0
        ? Math.round(dispensers.reduce((sum, d) => sum + (d.compliance || 0), 0) / dispensers.length)
        : stats.compliance

    const handleRefresh = async () => {
        setRefreshing(true)
        await new Promise(r => setTimeout(r, 800))
        setRefreshing(false)
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* ── Header ── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30">
                        <Radio className="h-7 w-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                            {t('medicineDispensers')}
                        </h1>
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                            {t('smartPillBoxes')} • {dispensers.length} {t('registered')}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={handleRefresh}
                        className="w-11 h-11 rounded-xl border flex items-center justify-center transition-all hover:bg-gray-50 dark:hover:bg-slate-800"
                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
                        <RefreshCw className={`h-4.5 w-4.5 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                    <button onClick={() => setShowMedicineManager(true)}
                        className="h-11 flex items-center gap-2 px-5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white font-semibold text-sm shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all">
                        <Pill className="h-4 w-4" />
                        {t('manageSchedules')}
                    </button>
                </div>
            </div>

            {/* ── Stats Grid ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-2xl border p-5 transition-all hover:shadow-md" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                            <Signal className="h-5 w-5 text-emerald-500" />
                        </div>
                        {offlineCount > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 dark:bg-red-900/20 text-red-500">
                                {offlineCount} offline
                            </span>
                        )}
                    </div>
                    <p className="text-3xl font-bold text-emerald-500">{loading ? '—' : onlineCount}</p>
                    <p className="text-xs font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{t('devicesOnline')}</p>
                    <div className="mt-3 w-full h-1.5 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500 transition-all duration-700"
                            style={{ width: dispensers.length > 0 ? `${(onlineCount / dispensers.length) * 100}%` : '0%' }} />
                    </div>
                </div>

                <div className="rounded-2xl border p-5 transition-all hover:shadow-md" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                            <ShieldCheck className="h-5 w-5 text-blue-500" />
                        </div>
                        <div className="flex items-center gap-1 text-emerald-500">
                            <TrendingUp className="h-3.5 w-3.5" />
                            <span className="text-[10px] font-bold">+5%</span>
                        </div>
                    </div>
                    <p className="text-3xl font-bold text-blue-500">{loading ? '—' : `${avgCompliance}%`}</p>
                    <p className="text-xs font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{t('avgCompliance')}</p>
                    <div className="mt-3 w-full h-1.5 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
                        <div className="h-full rounded-full bg-blue-500 transition-all duration-700" style={{ width: `${avgCompliance}%` }} />
                    </div>
                </div>

                <div className="rounded-2xl border p-5 transition-all hover:shadow-md" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                    <div className="flex items-center justify-between mb-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${lowBattery > 0 ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
                            {lowBattery > 0 ? <BatteryLow className="h-5 w-5 text-amber-500" /> : <BatteryCharging className="h-5 w-5 text-emerald-500" />}
                        </div>
                        {lowBattery > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
                                {t('needsAttention')}
                            </span>
                        )}
                    </div>
                    <p className={`text-3xl font-bold ${lowBattery > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                        {loading ? '—' : lowBattery}
                    </p>
                    <p className="text-xs font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{t('lowBattery')}</p>
                    <div className="mt-3 w-full h-1.5 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-700 ${lowBattery > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: dispensers.length > 0 ? `${((dispensers.length - lowBattery) / dispensers.length) * 100}%` : '100%' }} />
                    </div>
                </div>

                <div className="rounded-2xl border p-5 transition-all hover:shadow-md" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                            <Pill className="h-5 w-5 text-purple-500" />
                        </div>
                        <span className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>TODAY</span>
                    </div>
                    <p className="text-3xl font-bold text-purple-500">{loading ? '—' : stats.doses}</p>
                    <p className="text-xs font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{t('totalDoses')}</p>
                    <div className="mt-3 w-full h-1.5 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
                        <div className="h-full rounded-full bg-purple-500 transition-all duration-700"
                            style={{ width: stats.doses > 0 ? `${(stats.taken / stats.doses) * 100}%` : '0%' }} />
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════════════════ */}
            {/* ESP32-S3 REAL HARDWARE CONTROL PANEL           */}
            {/* ═══════════════════════════════════════════════ */}
            <div>
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                    <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                        Real-Time Hardware Control
                    </h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-purple-500/10 text-purple-500">
                        ESP32-S3 · Live
                    </span>
                </div>
                <div className="relative">
                    <ESP32HubPanel />
                </div>
            </div>

            {/* ── Registered Dispenser Cards ── */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                        {t('allDispensers')}
                    </h2>
                    <div className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                        <CircleDot className="h-3 w-3 text-emerald-500" />
                        <span>{onlineCount} {t('active')}</span>
                        {offlineCount > 0 && (
                            <>
                                <span>•</span>
                                <CircleDot className="h-3 w-3 text-red-500" />
                                <span>{offlineCount} offline</span>
                            </>
                        )}
                    </div>
                </div>

                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="rounded-2xl border p-6 space-y-4" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
                                <div className="skeleton h-6 w-3/4" /><div className="skeleton h-4 w-1/2" />
                                <div className="flex gap-2">
                                    {[1, 2, 3, 4].map(j => <div key={j} className="skeleton h-3 w-3 rounded-full" />)}
                                </div>
                                <div className="skeleton h-10 w-full" />
                            </div>
                        ))}
                    </div>
                ) : dispensers.length === 0 ? (
                    <div className="rounded-2xl border-2 border-dashed p-12 text-center" style={{ borderColor: 'var(--border-color)' }}>
                        <Package className="h-16 w-16 mx-auto mb-4 opacity-20" style={{ color: 'var(--text-muted)' }} />
                        <p className="text-lg font-semibold" style={{ color: 'var(--text-muted)' }}>No dispensers found</p>
                        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Register patients to see their dispensers here</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {dispensers.map(d => (
                            <div key={d.id}
                                onClick={() => setSelectedDispenser(selectedDispenser?.id === d.id ? null : d)}
                                className={`group rounded-2xl border-2 p-5 cursor-pointer transition-all hover:shadow-lg ${
                                    selectedDispenser?.id === d.id
                                        ? 'border-purple-400 dark:border-purple-500 shadow-lg shadow-purple-500/10'
                                        : d.status === 'offline'
                                            ? 'border-red-200 dark:border-red-900/50 opacity-75'
                                            : 'border-transparent hover:border-purple-200 dark:hover:border-purple-900/50'
                                }`}
                                style={{ background: 'var(--bg-secondary)', borderColor: selectedDispenser?.id === d.id ? undefined : d.status === 'offline' ? undefined : 'var(--border-color)' }}>

                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${d.status === 'online' ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                                            {d.status === 'online'
                                                ? <Wifi className="h-5 w-5 text-emerald-500" />
                                                : <WifiOff className="h-5 w-5 text-red-500" />}
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{d.patient}</p>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <MapPin className="h-3 w-3" style={{ color: 'var(--text-muted)' }} />
                                                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.location}</span>
                                                <span className="text-xs opacity-40" style={{ color: 'var(--text-muted)' }}>•</span>
                                                <span className="text-xs font-mono opacity-60" style={{ color: 'var(--text-muted)' }}>{d.id}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <ComplianceRing value={d.compliance || 0} />
                                </div>

                                <div className="flex items-center justify-between mb-4 p-3 rounded-xl" style={{ background: 'var(--bg-primary)' }}>
                                    <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('dispenserSlots')}</p>
                                        <SlotVisualizer total={d.slots} filled={d.filled} />
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('filled')}</p>
                                        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{d.filled}/{d.slots}</p>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between">
                                    <BatteryIndicator level={d.battery} />
                                    <div className="flex items-center gap-3">
                                        {d.nextDose && d.nextDose !== '—' && (
                                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-900/20">
                                                <Timer className="h-3 w-3 text-purple-500" />
                                                <span className="text-[11px] font-semibold text-purple-600 dark:text-purple-400">{d.nextDose}</span>
                                            </div>
                                        )}
                                        <div className="flex items-center gap-1.5">
                                            <Clock className="h-3 w-3" style={{ color: 'var(--text-muted)' }} />
                                            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{d.lastSync}</span>
                                        </div>
                                    </div>
                                </div>

                                {selectedDispenser?.id === d.id && (
                                    <div className="mt-4 pt-4 border-t space-y-3" style={{ borderColor: 'var(--border-color)' }}>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="p-3 rounded-xl" style={{ background: 'var(--bg-primary)' }}>
                                                <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</p>
                                                <div className="flex items-center gap-1.5 mt-1">
                                                    <div className={`w-2 h-2 rounded-full ${d.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                                                    <span className="text-sm font-semibold capitalize" style={{ color: 'var(--text-primary)' }}>{d.status}</span>
                                                </div>
                                            </div>
                                            <div className="p-3 rounded-xl" style={{ background: 'var(--bg-primary)' }}>
                                                <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('signal')}</p>
                                                <div className="flex items-center gap-1.5 mt-1">
                                                    <Signal className="h-3.5 w-3.5 text-emerald-500" />
                                                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                        {d.status === 'online' ? t('strong') : t('noSignal')}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setShowMedicineManager(true) }}
                                            className="w-full h-10 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white text-xs font-semibold flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-purple-500/30 transition-all">
                                            <Pill className="h-3.5 w-3.5" />
                                            {t('editSchedules')}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Medicine Compliance Section ── */}
            <MedicineCompliance />

            {/* ── Medicine Schedule Manager (Full Overlay) ── */}
            {showMedicineManager && (
                <div className="fixed inset-0 z-[9999] animate-fadeIn" style={{ background: 'var(--bg-primary)' }}>
                    <div className="h-full flex flex-col">
                        <div className="flex items-center justify-between px-6 py-3 border-b"
                            style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
                            <div className="flex items-center gap-3">
                                <button onClick={() => setShowMedicineManager(false)}
                                    className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500"
                                    style={{ color: 'var(--text-muted)' }}>
                                    <X className="h-5 w-5" />
                                </button>
                                <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>{t('backToDispensers')}</span>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            <MedicineScheduleManager />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
