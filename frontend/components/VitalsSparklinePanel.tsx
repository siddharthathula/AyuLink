'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Heart, Activity, Thermometer, Droplets } from 'lucide-react'

interface SparkPoint { value: number; timestamp: number }

interface VitalSparklineProps {
  patientId: string
  patientName: string
  color?: string
  showBP?: boolean
}

function MiniSparkline({
  points,
  color,
  min,
  max,
  width = 80,
  height = 32,
  dangerous = false,
}: {
  points: number[]
  color: string
  min: number
  max: number
  width?: number
  height?: number
  dangerous?: boolean
}) {
  if (points.length < 2) return <div style={{ width, height }} />

  const range = max - min || 1
  const svgPoints = points.map((v, i) => {
    const x = (i / (points.length - 1)) * width
    const y = height - ((v - min) / range) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const last = points[points.length - 1]
  const lastX = width
  const lastY = height - ((last - min) / range) * height

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        {dangerous && (
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        )}
      </defs>
      {/* Fill area */}
      <polygon
        points={`0,${height} ${svgPoints} ${width},${height}`}
        fill={`url(#grad-${color.replace('#', '')})`}
      />
      {/* Line */}
      <polyline
        points={svgPoints}
        fill="none"
        stroke={color}
        strokeWidth={dangerous ? 2 : 1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        filter={dangerous ? 'url(#glow)' : undefined}
        style={dangerous ? { animation: 'pulse 1s ease-in-out infinite alternate' } : undefined}
      />
      {/* Last point dot */}
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  )
}

export function VitalsSparklineCard({ patientId, patientName, color = '#10b981', showBP = false }: VitalSparklineProps) {
  const [hrHistory, setHrHistory] = useState<number[]>([75, 76, 74, 78, 72, 75])
  const [spo2History, setSpo2History] = useState<number[]>([97, 98, 97, 96, 98, 97])
  const [tempHistory, setTempHistory] = useState<number[]>([36.8, 36.9, 37.0, 36.8, 37.1, 36.9])
  const [bpHistory, setBpHistory] = useState<number[]>([120, 122, 118, 125, 121, 120])

  const [currentHr, setCurrentHr] = useState(75)
  const [currentSpo2, setCurrentSpo2] = useState(97)
  const [currentTemp, setCurrentTemp] = useState(36.9)
  const [currentBpSys, setCurrentBpSys] = useState(120)
  const [currentBpDia, setCurrentBpDia] = useState(80)

  const MAX_POINTS = 20

  const addPoint = useCallback((arr: number[], val: number) => {
    return [...arr.slice(-MAX_POINTS + 1), val]
  }, [])

  useEffect(() => {
    const handleVitals = (e: CustomEvent) => {
      const d = e.detail
      if (d.patientName !== patientName && d.deviceId !== patientId) return
      if (d.hr) { setCurrentHr(d.hr); setHrHistory(prev => addPoint(prev, d.hr)) }
      if (d.spo2) { setCurrentSpo2(d.spo2); setSpo2History(prev => addPoint(prev, d.spo2)) }
      if (d.temp) { setCurrentTemp(d.temp); setTempHistory(prev => addPoint(prev, d.temp)) }
    }
    window.addEventListener('vitals-update', handleVitals as EventListener)
    return () => window.removeEventListener('vitals-update', handleVitals as EventListener)
  }, [patientId, patientName, addPoint])

  // WebSocket live updates
  useEffect(() => {
    const wsUrl = `ws://${window.location.hostname}:8000/ws/dashboard`
    let ws: WebSocket
    let dead = false

    const connect = () => {
      if (dead) return
      ws = new WebSocket(wsUrl)
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.event === 'vital' && (msg.data.patient_id === patientId || msg.data.patient_id === 'P_01')) {
            const d = msg.data
            if (d.hr > 0) { setCurrentHr(d.hr); setHrHistory(p => addPoint(p, d.hr)) }
            if (d.spo2 > 0) { setCurrentSpo2(d.spo2); setSpo2History(p => addPoint(p, d.spo2)) }
            if (d.temp > 0) { setCurrentTemp(d.temp); setTempHistory(p => addPoint(p, d.temp)) }
            if (d.bp_systolic > 0) { setCurrentBpSys(d.bp_systolic); setCurrentBpDia(d.bp_diastolic || 80); setBpHistory(p => addPoint(p, d.bp_systolic)) }
          }
        } catch { /* ignore */ }
      }
      ws.onclose = () => { if (!dead) setTimeout(connect, 2000) }
      ws.onerror = () => ws.close()
    }

    connect()
    return () => { dead = true; ws?.close() }
  }, [patientId, addPoint])

  const hrDanger = currentHr > 120 || currentHr < 40
  const spo2Danger = currentSpo2 < 90
  const tempDanger = currentTemp > 39 || currentTemp < 35
  const bpDanger = currentBpSys >= 180

  const vitals = [
    {
      label: 'Heart Rate',
      icon: Heart,
      value: currentHr,
      unit: 'bpm',
      history: hrHistory,
      danger: hrDanger,
      warning: currentHr > 100 || currentHr < 55,
      min: 40,
      max: 160,
      color: hrDanger ? '#ef4444' : '#f43f5e',
      normal: '60–100',
    },
    {
      label: 'SpO₂',
      icon: Activity,
      value: `${currentSpo2}%`,
      unit: '',
      history: spo2History,
      danger: spo2Danger,
      warning: currentSpo2 < 94,
      min: 85,
      max: 100,
      color: spo2Danger ? '#ef4444' : '#3b82f6',
      normal: '>94%',
    },
    {
      label: 'Temperature',
      icon: Thermometer,
      value: `${currentTemp.toFixed(1)}°`,
      unit: 'C',
      history: tempHistory,
      danger: tempDanger,
      warning: currentTemp > 38,
      min: 35,
      max: 40,
      color: tempDanger ? '#ef4444' : currentTemp > 37.5 ? '#f59e0b' : '#8b5cf6',
      normal: '36–37.5',
    },
  ]

  if (showBP) {
    vitals.push({
      label: 'Blood Pressure',
      icon: Droplets,
      value: `${currentBpSys}/${currentBpDia}`,
      unit: 'mmHg',
      history: bpHistory,
      danger: bpDanger,
      warning: currentBpSys >= 140,
      min: 80,
      max: 200,
      color: bpDanger ? '#ef4444' : '#06b6d4',
      normal: '<140/90',
    })
  }

  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
      }}
    >
      <div className="flex items-center justify-between">
        <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{patientName}</p>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{
            background: hrDanger || spo2Danger || tempDanger ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
            color: hrDanger || spo2Danger || tempDanger ? '#ef4444' : '#10b981',
          }}
        >
          {hrDanger || spo2Danger || tempDanger ? '⚠ CRITICAL' : '✓ STABLE'}
        </span>
      </div>

      <div className="space-y-2">
        {vitals.map((vital) => {
          const Icon = vital.icon
          return (
            <div key={vital.label} className="flex items-center gap-3">
              <div className="flex items-center gap-2 w-28 flex-shrink-0">
                <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: vital.color }} />
                <div>
                  <p className="text-[10px] font-semibold leading-none" style={{ color: 'var(--text-muted)' }}>{vital.label}</p>
                  <p className="text-sm font-black leading-tight" style={{ color: vital.danger ? '#ef4444' : vital.warning ? '#f59e0b' : 'var(--text-primary)' }}>
                    {vital.value}
                    {vital.unit && <span className="text-[9px] font-normal ml-0.5" style={{ color: 'var(--text-muted)' }}>{vital.unit}</span>}
                  </p>
                </div>
              </div>
              <div className="flex-1 flex items-center justify-end">
                <MiniSparkline
                  points={vital.history}
                  color={vital.color}
                  min={vital.min}
                  max={vital.max}
                  width={90}
                  height={28}
                  dangerous={vital.danger}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Multi-patient panel
export default function VitalsSparklinePanel() {
  const [patients, setPatients] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    const fetchPatients = async () => {
      try {
        const res = await fetch(`http://${window.location.hostname}:8000/api/live/patients`)
        const data = await res.json()
        if (Array.isArray(data) && data.length > 0) {
          setPatients(data.slice(0, 3).map((p: any) => ({ id: p.id, name: p.name || p.id })))
        }
      } catch {
        // Default to P_01 for demo
        setPatients([{ id: 'P_01', name: 'Test Patient' }])
      }
    }
    fetchPatients()
    const i = setInterval(fetchPatients, 30000)
    return () => clearInterval(i)
  }, [])

  if (patients.length === 0) {
    return null  // Don't render empty placeholder — eliminates wasted space
  }

  return (
    <div className="card animate-fadeInUp">
      <div className="p-5 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/30">
            <Activity className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Live Vitals Trends</h2>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Real-time sparkline charts · {patients.length} patient{patients.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>
      <div className="p-4 space-y-3">
        {patients.map(p => (
          <VitalsSparklineCard key={p.id} patientId={p.id} patientName={p.name} showBP={true} />
        ))}
      </div>
    </div>
  )
}
