'use client'

import { useState, useEffect, useCallback } from 'react'
import {
    Pill, Clock, CheckCircle, AlertCircle, Bell, Zap,
    Thermometer, Droplets, Wind, Flame, Wifi, WifiOff,
    RefreshCw, ChevronRight, Activity, Sparkles
} from 'lucide-react'
import { useTheme } from '@/lib/theme-context'

// ── Types ─────────────────────────────────────────────────────────
interface HubData {
    online: boolean
    pill_slot1: boolean
    pill_slot2: boolean
    pill_slot3: boolean
    pill_slot4: boolean
    env_temp: number
    humidity: number
    air_ppm: number
    air_aqi: string
    flame: boolean
    rtc_time: string
    rtc_date: string
    rssi: number
    uptime: number
    last_seen: number
}

interface SlotDef {
    slot: number
    label: string
    medicine: string
    dosage: string
    scheduledTime: string
    icon: string
}

// Static pill schedule for Patient 108 (Ramulu Goud)
const PILL_SLOTS: SlotDef[] = [
    { slot: 1, label: 'Morning',   medicine: 'Metformin',    dosage: '500mg', scheduledTime: '08:00', icon: '🌅' },
    { slot: 2, label: 'Afternoon', medicine: 'Amlodipine',   dosage: '5mg',   scheduledTime: '13:00', icon: '☀️' },
    { slot: 3, label: 'Evening',   medicine: 'Atorvastatin', dosage: '20mg',  scheduledTime: '18:00', icon: '🌆' },
    { slot: 4, label: 'Night',     medicine: 'Aspirin',      dosage: '75mg',  scheduledTime: '22:00', icon: '🌙' },
]

function slotKey(slot: number): keyof HubData {
    return `pill_slot${slot}` as keyof HubData
}

function getSlotStatus(slot: SlotDef, hub: HubData): 'taken' | 'missed' | 'upcoming' | 'pending' {
    const taken = hub[slotKey(slot.slot)] as boolean
    if (taken) return 'taken'

    // Compare against RTC time from hub (or local time as fallback)
    const nowStr = hub.rtc_time || new Date().toTimeString().slice(0, 5)
    const [nowH, nowM] = nowStr.split(':').map(Number)
    const [schH, schM] = slot.scheduledTime.split(':').map(Number)
    const nowMins = nowH * 60 + nowM
    const schMins = schH * 60 + schM

    if (nowMins < schMins - 15) return 'upcoming'
    if (nowMins > schMins + 60) return 'missed'
    return 'pending'
}

const STATUS_STYLES: Record<string, string> = {
    taken:    'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    missed:   'text-rose-400 bg-rose-500/10 border-rose-500/20',
    pending:  'text-amber-400 bg-amber-500/10 border-amber-500/20',
    upcoming: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
}

const STATUS_ICONS: Record<string, React.ReactElement> = {
    taken:    <CheckCircle className="h-4 w-4" />,
    missed:   <AlertCircle className="h-4 w-4" />,
    pending:  <Bell className="h-4 w-4" />,
    upcoming: <Clock className="h-4 w-4" />,
}

// ── Component ─────────────────────────────────────────────────────
export default function MedicineCompliance() {
    const { t } = useTheme()
    const [hub, setHub] = useState<HubData | null>(null)
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<'all' | 'upcoming' | 'missed'>('all')
    const [dispensing, setDispensing] = useState<number | null>(null)
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

    const fetchHub = useCallback(async () => {
        try {
            const res = await fetch('http://localhost:8000/api/hub')
            if (res.ok) {
                const data: HubData = await res.json()
                setHub(data)
                setLastRefresh(new Date())
            }
        } catch {
            // backend offline
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchHub()
        // Poll every 3s
        const interval = setInterval(fetchHub, 3000)

        // Also subscribe to WebSocket hub events for instant updates
        try {
            const ws = new WebSocket('ws://localhost:8000/ws/dashboard')
            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data)
                    if (msg.event === 'hub') fetchHub()
                } catch {}
            }
            return () => {
                clearInterval(interval)
                ws.close()
            }
        } catch {
            return () => clearInterval(interval)
        }
    }, [fetchHub])

    const handleDispense = async (slot: number) => {
        setDispensing(slot)
        try {
            await fetch(`http://localhost:8000/api/dispense/${slot}`, { method: 'POST' })
            setTimeout(fetchHub, 2000)  // refresh after servo moves
        } catch {}
        setTimeout(() => setDispensing(null), 3000)
    }

    // Compute stats
    const taken    = PILL_SLOTS.filter(s => hub && (hub[slotKey(s.slot)] as boolean)).length
    const todayPct = Math.round((taken / PILL_SLOTS.length) * 100)
    const missed   = hub ? PILL_SLOTS.filter(s => getSlotStatus(s, hub) === 'missed').length : 0
    const upcoming = hub ? PILL_SLOTS.filter(s => getSlotStatus(s, hub) === 'upcoming').length : 0

    const visibleSlots = PILL_SLOTS.filter(s => {
        if (!hub) return true
        const status = getSlotStatus(s, hub)
        if (filter === 'all') return true
        if (filter === 'missed') return status === 'missed'
        if (filter === 'upcoming') return status === 'upcoming' || status === 'pending'
        return true
    })

    const dispenserOnline = hub?.online ?? false
    const lastSeenSec = hub ? Math.floor(Date.now() / 1000 - hub.last_seen) : null

    return (
        <div className="h-full flex flex-col overflow-hidden animate-fadeIn">

            {/* ── Header ── */}
            <div className="p-6 border-b border-white/5 bg-white/5 backdrop-blur-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pink-600 to-rose-500 flex items-center justify-center shadow-lg shadow-rose-500/20">
                            <Activity className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>
                                {t('adherenceStream')}
                            </h2>
                            <p className="text-xs font-medium opacity-50" style={{ color: 'var(--text-muted)' }}>
                                Live Dispenser Telemetry · Patient 108 — Ramulu Goud
                            </p>
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Dispenser status badge */}
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-black ${dispenserOnline ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-rose-400 border-rose-500/30 bg-rose-500/10'}`}>
                            {dispenserOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                            {dispenserOnline ? 'DISPENSER LIVE' : `OFFLINE${lastSeenSec != null ? ` · ${lastSeenSec}s ago` : ''}`}
                        </div>

                        {/* Today */}
                        <div className="px-3 py-1.5 rounded-xl border-2 flex flex-col items-center min-w-[60px]" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}>
                            <span className="text-base font-black text-emerald-400 leading-none">{todayPct}%</span>
                            <span className="text-[8px] font-black uppercase tracking-widest opacity-50 mt-0.5">Today</span>
                        </div>

                        {/* Streak */}
                        <div className="px-3 py-1.5 rounded-xl border-2 flex flex-col items-center min-w-[60px]" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}>
                            <div className="flex items-center gap-1">
                                <Sparkles className="w-3 h-3 text-amber-400" />
                                <span className="text-base font-black text-amber-400 leading-none">{taken}</span>
                            </div>
                            <span className="text-[8px] font-black uppercase tracking-widest opacity-50 mt-0.5">Taken</span>
                        </div>

                        {/* Refresh */}
                        <button onClick={fetchHub} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/10 transition-all" title="Refresh">
                            <RefreshCw className="h-4 w-4 opacity-50" />
                        </button>
                    </div>
                </div>

                {/* ── Env Sensors Row ── */}
                {hub && (
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
                            <Thermometer className="h-4 w-4 text-orange-400 shrink-0" />
                            <div>
                                <p className="text-xs font-black text-orange-400">{(hub.env_temp ?? 0).toFixed(1)}°C</p>
                                <p className="text-[9px] opacity-50 uppercase tracking-wider">Room Temp</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
                            <Droplets className="h-4 w-4 text-blue-400 shrink-0" />
                            <div>
                                <p className="text-xs font-black text-blue-400">{(hub.humidity ?? 0).toFixed(0)}%</p>
                                <p className="text-[9px] opacity-50 uppercase tracking-wider">Humidity</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
                            <Wind className={`h-4 w-4 shrink-0 ${hub.air_ppm > 200 ? 'text-rose-400' : hub.air_ppm > 100 ? 'text-amber-400' : 'text-emerald-400'}`} />
                            <div>
                                <p className={`text-xs font-black ${hub.air_ppm > 200 ? 'text-rose-400' : hub.air_ppm > 100 ? 'text-amber-400' : 'text-emerald-400'}`}>{hub.air_ppm} PPM</p>
                                <p className="text-[9px] opacity-50 uppercase tracking-wider">{hub.air_aqi}</p>
                            </div>
                        </div>
                        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${hub.flame ? 'bg-rose-500/20 border border-rose-500/40 animate-pulse' : ''}`} style={hub.flame ? {} : { background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
                            <Flame className={`h-4 w-4 shrink-0 ${hub.flame ? 'text-rose-400' : 'text-gray-500'}`} />
                            <div>
                                <p className={`text-xs font-black ${hub.flame ? 'text-rose-400' : 'text-gray-400'}`}>{hub.flame ? 'FIRE!' : 'Clear'}</p>
                                <p className="text-[9px] opacity-50 uppercase tracking-wider">Flame Sensor</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* RTC time */}
                {hub?.rtc_time && (
                    <p className="mt-3 text-[10px] font-black opacity-30 uppercase tracking-widest">
                        Dispenser RTC · {hub.rtc_date} {hub.rtc_time} · Refreshed {lastRefresh.toLocaleTimeString()}
                    </p>
                )}

                {/* Filter tabs */}
                <div className="flex gap-2 mt-4 overflow-x-auto pb-1 no-scrollbar">
                    {(['all', 'upcoming', 'missed'] as const).map(f => (
                        <button key={f} onClick={() => setFilter(f)}
                            className={`px-5 py-1.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                                filter === f
                                    ? f === 'missed'
                                        ? 'bg-gradient-to-r from-red-500 to-rose-500 text-white shadow-lg shadow-red-500/20'
                                        : f === 'upcoming'
                                            ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/20'
                                            : 'bg-gradient-to-r from-pink-600 to-rose-500 text-white shadow-lg shadow-rose-500/20'
                                    : 'bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                            }`}>
                            {f === 'all' ? `Combined Log (${PILL_SLOTS.length})` : f === 'upcoming' ? `Scheduled (${upcoming})` : `Missed (${missed})`}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Pill Slot List ── */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
                {loading ? (
                    <div className="text-center py-20">
                        <RefreshCw className="h-10 w-10 animate-spin text-rose-500 mx-auto" />
                        <p className="mt-4 text-[10px] font-black uppercase tracking-widest opacity-40">Connecting to Dispenser...</p>
                    </div>
                ) : (
                    <>
                        {visibleSlots.map((slot) => {
                            const status = hub ? getSlotStatus(slot, hub) : 'upcoming'
                            const isTaken = hub ? (hub[slotKey(slot.slot)] as boolean) : false
                            return (
                                <div key={slot.slot}
                                    className="group flex items-center justify-between p-4 rounded-2xl border-2 transition-all hover:bg-white/5"
                                    style={{ borderColor: 'var(--border-color)' }}>
                                    <div className="flex items-center gap-4">
                                        {/* Icon */}
                                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-inner ${
                                            isTaken ? 'bg-emerald-500/10' : status === 'missed' ? 'bg-rose-500/10' : 'bg-pink-500/10'}`}>
                                            {slot.icon}
                                        </div>

                                        {/* Info */}
                                        <div>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-black text-base" style={{ color: 'var(--text-primary)' }}>
                                                    {slot.medicine}
                                                </p>
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-white/5 border border-white/10 text-white/50">
                                                    {slot.dosage}
                                                </span>
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-white/5 border border-white/10 text-white/40">
                                                    Slot {slot.slot}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3 mt-1 text-xs font-bold opacity-60" style={{ color: 'var(--text-muted)' }}>
                                                <span className="flex items-center gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    {slot.label} · {slot.scheduledTime}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Pill className="h-3 w-3" />
                                                    Ramulu Goud
                                                </span>
                                            </div>
                                            {/* Progress bar for taken */}
                                            {isTaken && (
                                                <div className="mt-1.5 w-40 h-1 bg-white/10 rounded-full overflow-hidden">
                                                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: '100%' }} />
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Right side: status + dispense button */}
                                    <div className="flex items-center gap-2">
                                        <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border ${STATUS_STYLES[status]}`}>
                                            {STATUS_ICONS[status]}
                                            {status}
                                        </span>

                                        {/* Manual dispense button — only if not taken and dispenser online */}
                                        {!isTaken && dispenserOnline && (
                                            <button
                                                onClick={() => handleDispense(slot.slot)}
                                                disabled={dispensing !== null}
                                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all
                                                    ${dispensing === slot.slot
                                                        ? 'text-amber-400 border-amber-500/30 bg-amber-500/10 animate-pulse'
                                                        : 'text-purple-400 border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 opacity-0 group-hover:opacity-100'
                                                    }`}
                                                title="Dispense now">
                                                <Zap className="h-3.5 w-3.5" />
                                                {dispensing === slot.slot ? 'Dispensing...' : 'Dispense'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )
                        })}

                        {visibleSlots.length === 0 && (
                            <div className="text-center py-20 bg-[var(--bg-primary)] rounded-[40px] border-2 border-dashed border-[var(--border-color)] opacity-40">
                                <Sparkles className="h-16 w-16 mx-auto mb-4 opacity-10" />
                                <p className="font-black text-sm uppercase tracking-widest">Station Clean · No Alerts</p>
                            </div>
                        )}

                        {/* Hub offline notice */}
                        {!dispenserOnline && (
                            <div className="flex items-center gap-3 p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 text-amber-400 text-xs font-black">
                                <WifiOff className="h-5 w-5 shrink-0" />
                                <span>Dispenser hub offline — showing last known pill slot state. Connect NodeMCU to WiFi to enable live control.</span>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
