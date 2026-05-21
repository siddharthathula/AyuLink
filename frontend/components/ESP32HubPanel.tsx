'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
    Clock, CheckCircle, AlertCircle, RotateCcw, Play, Loader2,
    Cpu, Wind, Flame, Camera, Thermometer, Droplets, Pill, Radio
} from 'lucide-react'

interface HubSlotState {
    slot: number
    label: string
    angle: number
    taken: boolean
    time: string
}

interface HubLiveState {
    connected: boolean
    deviceId: string
    rssi: number
    uptime: number
    slots: HubSlotState[]
    lastUpdate: number
}

const SLOT_DEFAULTS: HubSlotState[] = [
    { slot: 1, label: 'Morning',   angle: 0,   taken: false, time: '08:00 AM' },
    { slot: 2, label: 'Afternoon', angle: 60,  taken: false, time: '01:00 PM' },
    { slot: 3, label: 'Evening',   angle: 120, taken: false, time: '06:00 PM' },
    { slot: 4, label: 'Night',     angle: 180, taken: false, time: '10:00 PM' },
]

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

export default function ESP32HubPanel() {
    const [hubState, setHubState] = useState<HubLiveState>({
        connected: false,
        deviceId: 'Patient 108 (NodeMCU + ESP32-CAM)',
        rssi: 0,
        uptime: 0,
        slots: SLOT_DEFAULTS,
        lastUpdate: 0,
    })
    const [dispensing, setDispensing] = useState<number | null>(null)
    const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' | 'info' } | null>(null)
    const [envData, setEnvData] = useState({
        air_ppm: 0, air_aqi: 'Unknown', flame: false,
        env_temp: 0.0, humidity: 0.0,
        rtc_time: '', rtc_date: '',
    })
    const [camUrl, setCamUrl] = useState<string>('')
    const [camConnected, setCamConnected] = useState(false)
    const wsRef  = useRef<WebSocket | null>(null)
    const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const showToast = (msg: string, type: 'ok' | 'err' | 'info' = 'ok') => {
        setToast({ msg, type })
        setTimeout(() => setToast(null), 3500)
    }

    const connect = useCallback(() => {
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
                        setEnvData({
                            air_ppm: d.air_ppm ?? 0,
                            air_aqi: d.air_aqi ?? 'Unknown',
                            flame: d.flame ?? false,
                            env_temp: d.env_temp ?? 0,
                            humidity: d.humidity ?? 0,
                            rtc_time: d.rtc_time ?? '',
                            rtc_date: d.rtc_date ?? '',
                        })
                    }

                    if (msg.event === 'hub_status') {
                        setHubState(prev => ({ ...prev, connected: msg.data?.connected ?? prev.connected }))
                        if (msg.data?.connected) showToast('ESP32-S3 Dispenser Online!', 'ok')
                        else showToast('ESP32-S3 Dispenser Offline', 'err')
                    }
                } catch { /* ignore */ }
            }

            ws.onclose = () => {
                setHubState(prev => ({ ...prev, connected: false }))
                retryRef.current = setTimeout(connect, 4000)
            }
            ws.onerror = () => ws.close()
            wsRef.current = ws

        } catch {
            retryRef.current = setTimeout(connect, 4000)
        }
    }, [])

    useEffect(() => {
        connect()
        // Set cam URL dynamically so it works from any device on the network
        if (typeof window !== 'undefined') {
            setCamUrl(`http://${window.location.hostname}:8000/api/stream`)
            setCamConnected(true)  // optimistic — onError will flip to false
        }
        return () => {
            wsRef.current?.close()
            if (retryRef.current) clearTimeout(retryRef.current)
        }
    }, [connect])

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
            const res = await fetch(`/api/dispense/${slot}`, { method: 'POST' }).catch(() => null)
            if (res?.ok) {
                const data = await res.json()
                if (data.ok) {
                    setHubState(prev => ({
                        ...prev,
                        slots: prev.slots.map(s => s.slot === slot ? { ...s, taken: true } : s)
                    }))
                    showToast(`✓ Slot ${slot} dispensed!`, 'ok')
                } else {
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ action: 'dispense', slot }))
                        setHubState(prev => ({
                            ...prev,
                            slots: prev.slots.map(s => s.slot === slot ? { ...s, taken: true } : s)
                        }))
                        showToast(`✓ Slot ${slot} dispensed (via WS)`, 'ok')
                    } else {
                        showToast(`Error: ${data.error || 'Hub not connected'}`, 'err')
                    }
                }
            } else {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ action: 'dispense', slot }))
                    showToast(`Sent dispense command via WS`, 'info')
                } else {
                    showToast('Backend unreachable', 'err')
                }
            }
        } finally {
            setTimeout(() => setDispensing(null), 2500)
        }
    }

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

    // ── Compact offline card — avoids massive empty space ──────────────
    if (!hubState.connected) {
        return (
            <div className="rounded-2xl border px-5 py-4 flex items-center gap-4"
                style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
                <div className="w-10 h-10 rounded-xl bg-slate-700 flex items-center justify-center flex-shrink-0">
                    <Cpu className="h-5 w-5 text-slate-400" />
                </div>
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Patient 108 Hardware Hub</h3>
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-red-500/10 text-red-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />OFFLINE
                        </span>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        Waiting for NodeMCU Smart Dispenser to connect…
                    </p>
                </div>
                <Loader2 className="h-4 w-4 text-slate-400 animate-spin flex-shrink-0" />
            </div>
        )
    }

    return (
        <div className="rounded-3xl border-2 overflow-hidden"
            style={{ borderColor: 'rgb(168 85 247 / 0.5)', background: 'var(--bg-secondary)' }}>
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
                                Patient 108 Hardware Hub
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
                                <div className={`w-2 h-2 rounded-full ${isTaken ? 'bg-emerald-500'
                                    : isDispensing ? 'bg-blue-500 animate-ping'
                                        : 'bg-gray-300 dark:bg-slate-600'}`} />
                            </div>
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
                            <div className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg text-center
                                ${isTaken ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                    : isDispensing ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                        : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400'}`}>
                                {isTaken ? '✓ Taken' : isDispensing ? 'Dispensing...' : 'Pending'}
                            </div>
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

            <div className="px-5 pb-3 grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className={`rounded-xl p-3 border ${envData.air_ppm > 300 ? 'border-red-500/40 bg-red-500/10' : envData.air_ppm > 150 ? 'border-amber-500/40 bg-amber-500/10' : 'border-emerald-500/30 bg-emerald-500/10'}`}>
                    <div className="flex items-center gap-2 mb-1">
                        <Wind className={`h-4 w-4 ${envData.air_ppm > 300 ? 'text-red-400' : envData.air_ppm > 150 ? 'text-amber-400' : 'text-emerald-400'}`} />
                        <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Air Quality (MQ-135)</span>
                    </div>
                    <p className="text-lg font-black" style={{ color: 'var(--text-primary)' }}>{envData.air_ppm} PPM</p>
                    <p className={`text-[10px] font-bold ${envData.air_ppm > 300 ? 'text-red-400' : envData.air_ppm > 150 ? 'text-amber-400' : 'text-emerald-400'}`}>{envData.air_aqi}</p>
                </div>
                <div className={`rounded-xl p-3 border ${envData.flame ? 'border-red-500/60 bg-red-500/20 animate-pulse' : 'border-emerald-500/30 bg-emerald-500/10'}`}>
                    <div className="flex items-center gap-2 mb-1">
                        <Flame className={`h-4 w-4 ${envData.flame ? 'text-red-400' : 'text-emerald-400'}`} />
                        <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Flame Sensor</span>
                    </div>
                    <p className={`text-lg font-black ${envData.flame ? 'text-red-400' : 'text-emerald-400'}`}>{envData.flame ? '🔥 FIRE' : '✓ Clear'}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{envData.flame ? 'Alert active!' : 'No detection'}</p>
                </div>
                <div className="rounded-xl p-3 border" style={{ borderColor: 'rgba(251,146,60,0.3)', background: 'rgba(251,146,60,0.08)' }}>
                    <div className="flex items-center gap-2 mb-1">
                        <Thermometer className="h-4 w-4 text-orange-400" />
                        <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Room Temp (DHT11)</span>
                    </div>
                    <p className="text-lg font-black text-orange-400">
                        {envData.env_temp > 0 ? `${envData.env_temp.toFixed(1)}°C` : '—'}
                    </p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Ambient temperature</p>
                </div>
                <div className="rounded-xl p-3 border" style={{ borderColor: 'rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.08)' }}>
                    <div className="flex items-center gap-2 mb-1">
                        <Droplets className="h-4 w-4 text-blue-400" />
                        <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Humidity (DHT11)</span>
                    </div>
                    <p className="text-lg font-black text-blue-400">
                        {envData.humidity > 0 ? `${envData.humidity.toFixed(1)}%` : '—'}
                    </p>
                    <p className={`text-[10px] font-bold ${
                        envData.humidity > 70 ? 'text-amber-400' : envData.humidity < 30 ? 'text-red-400' : 'text-emerald-400'
                    }`}>
                        {envData.humidity > 70 ? 'High — risk of mold' : envData.humidity < 30 ? 'Low — dry air' : 'Comfortable'}
                    </p>
                </div>
                <div className="rounded-xl p-3 border" style={{ borderColor: 'rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.08)' }}>
                    <div className="flex items-center gap-2 mb-1">
                        <Clock className="h-4 w-4 text-violet-400" />
                        <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>RTC Clock (DS3231)</span>
                    </div>
                    <p className="text-lg font-black text-violet-400" suppressHydrationWarning>
                        {envData.rtc_time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }} suppressHydrationWarning>
                        {envData.rtc_date || new Date().toLocaleDateString()} · Precise I²C RTC
                    </p>
                </div>
                <div className="rounded-xl p-3 border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}>
                    <div className="flex items-center gap-2 mb-1">
                        <Camera className="h-4 w-4 text-blue-400" />
                        <span className="text-white text-xs font-semibold tracking-wider">ROOM CAMERA</span>
                    </div>
                </div>
            </div>

            {/* ── Camera Feed — always show container ── */}
            <div className="p-3 flex justify-center">
                <div className="relative rounded-xl overflow-hidden bg-black flex items-center justify-center" style={{ height: 240, width: 320, border: '1px solid var(--border-color)' }}>
                    {camUrl && (
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
                    )}
                    <div className="absolute top-3 left-3 flex items-center gap-2 px-2 py-1 rounded-full bg-red-500/80 text-white text-xs font-bold">
                        <span className={`w-2 h-2 rounded-full ${camConnected ? 'bg-white animate-pulse' : 'bg-gray-400'}`} /> {camConnected ? 'LIVE' : 'CONNECTING'}
                    </div>
                    {!camConnected && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: 'rgba(0,0,0,0.85)' }}>
                            <Camera className="h-10 w-10 mb-2 opacity-30 text-white" />
                            <p className="text-white text-xs font-semibold">Connecting to camera...</p>
                        </div>
                    )}
                </div>
            </div>

            <div className="px-5 pb-5">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
                        Daily Compliance
                    </span>
                    <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                        {takenCount}/4 doses taken
                    </span>
                </div>
                <div className="w-full h-2 rounded-full overflow-hidden bg-gray-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-pink-500 transition-all duration-700"
                        style={{ width: `${compliancePct}%` }} />
                </div>
            </div>

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
