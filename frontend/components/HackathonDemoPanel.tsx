'use client'

import { useState, useRef } from 'react'
import { Zap, Heart, AlertTriangle, Flame, Radio, Play, CheckCircle, X, Lock } from 'lucide-react'
import { useDemoMode } from '@/lib/demo-context'

interface DemoScenario {
  id: string
  label: string
  icon: React.ElementType
  color: string
  glow: string
  description: string
  endpoint: string
  eventType?: string
  delay?: number
}

const SCENARIOS: DemoScenario[] = [
  {
    id: 'sos',
    label: 'SOS Button',
    icon: AlertTriangle,
    color: '#ef4444',
    glow: 'rgba(239,68,68,0.4)',
    description: 'Patient presses emergency SOS — fullscreen alert fires',
    endpoint: '/api/simulate/sos',
  },
  {
    id: 'fall',
    label: 'Fall Detected',
    icon: Zap,
    color: '#f97316',
    glow: 'rgba(249,115,22,0.4)',
    description: 'MPU6050 detects sudden fall — emergency dispatch triggered',
    endpoint: '/api/simulate/fall',
  },
  {
    id: 'cardiac',
    label: 'Cardiac Event',
    icon: Heart,
    color: '#ec4899',
    glow: 'rgba(236,72,153,0.4)',
    description: 'HR spikes to 145+ bpm — AI triage fires instantly',
    endpoint: '/api/simulate/cardiac',
  },
  {
    id: 'flame',
    label: 'Flame Alert',
    icon: Flame,
    color: '#fb923c',
    glow: 'rgba(251,146,60,0.4)',
    description: 'Smart Hub flame sensor triggered — fire alert to all',
    endpoint: '/api/simulate/flame',
  },
]

export default function HackathonDemoPanel() {
  const { isDemoMode } = useDemoMode()
  const [running, setRunning] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [fullSequence, setFullSequence] = useState(false)
  const [sequenceStep, setSequenceStep] = useState(-1)
  const [log, setLog] = useState<string[]>([])
  const abortRef = useRef(false)

  const addLog = (msg: string) => setLog(prev => [msg, ...prev].slice(0, 8))

  const fireScenario = async (scenario: DemoScenario): Promise<void> => {
    setRunning(scenario.id)
    addLog(`🚀 Triggering: ${scenario.label}...`)
    try {
      const res = await fetch(`http://${window.location.hostname}:8000${scenario.endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: scenario.id, patient_id: 'P_01' }),
      })
      if (res.ok) {
        const data = await res.json()
        addLog(`✅ ${scenario.label} → alert sent to ${data.patient || 'Test Patient'}`)
        setDone(prev => new Set([...prev, scenario.id]))
      } else {
        addLog(`⚠️ ${scenario.label} → server error ${res.status}`)
      }
    } catch {
      // Try alternate endpoint format
      try {
        await fetch(`http://${window.location.hostname}:8000/api/simulate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: scenario.id, patient_id: 'P_01' }),
        })
        addLog(`✅ ${scenario.label} fired (fallback)`)
        setDone(prev => new Set([...prev, scenario.id]))
      } catch {
        addLog(`❌ Backend not reachable — is it running?`)
      }
    }
    setRunning(null)
  }

  const runFullSequence = async () => {
    setFullSequence(true)
    setDone(new Set())
    setLog([])
    abortRef.current = false
    addLog('🎬 Full hackathon demo sequence starting...')

    for (let i = 0; i < SCENARIOS.length; i++) {
      if (abortRef.current) break
      setSequenceStep(i)
      await fireScenario(SCENARIOS[i])
      if (i < SCENARIOS.length - 1) {
        addLog(`⏳ Next scenario in 4 seconds...`)
        await new Promise(r => setTimeout(r, 4000))
      }
    }

    setSequenceStep(-1)
    setFullSequence(false)
    if (!abortRef.current) addLog('🏆 Demo complete! All scenarios fired.')
  }

  const stopSequence = () => {
    abortRef.current = true
    setFullSequence(false)
    setSequenceStep(-1)
    setRunning(null)
    addLog('⏹ Sequence stopped.')
  }

  const reset = () => {
    setDone(new Set())
    setLog([])
    setRunning(null)
    setSequenceStep(-1)
    setFullSequence(false)
    abortRef.current = true
  }

  if (!isDemoMode) return null

  return (
    <div
      className="card animate-fadeInUp"
      style={{ border: '1px solid rgba(251,146,60,0.3)', boxShadow: '0 0 30px rgba(251,146,60,0.08)' }}
    >
      {/* Header */}
      <div className="p-5 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
              style={{ background: 'linear-gradient(135deg, #f97316, #dc2626)', boxShadow: '0 4px 15px rgba(249,115,22,0.4)' }}
            >
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                Hackathon Demo Mode
              </h2>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                Fire real IoT emergency scenarios for judges
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {done.size > 0 && (
              <button
                onClick={reset}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition-all"
                title="Reset"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scenario Buttons */}
      <div className="p-4 grid grid-cols-2 gap-3">
        {SCENARIOS.map((scenario, i) => {
          const Icon = scenario.icon
          const isDone = done.has(scenario.id)
          const isRunning = running === scenario.id
          const isActiveInSeq = sequenceStep === i

          return (
            <button
              key={scenario.id}
              onClick={() => !fullSequence && fireScenario(scenario)}
              disabled={fullSequence || isRunning}
              className="group relative rounded-2xl p-4 text-left transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed overflow-hidden"
              style={{
                background: isDone
                  ? 'rgba(16,185,129,0.1)'
                  : 'var(--bg-primary)',
                border: isActiveInSeq
                  ? `2px solid ${scenario.color}`
                  : isDone
                    ? '1px solid rgba(16,185,129,0.4)'
                    : '1px solid var(--border-color)',
                boxShadow: isActiveInSeq ? `0 0 20px ${scenario.glow}` : 'none',
              }}
            >
              {/* Glow on hover */}
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                style={{ background: `radial-gradient(circle at 50% 0%, ${scenario.glow.replace('0.4', '0.1')} 0%, transparent 70%)` }}
              />

              {/* Running pulse */}
              {isRunning && (
                <div
                  className="absolute inset-0 animate-pulse pointer-events-none"
                  style={{ background: `${scenario.color}15` }}
                />
              )}

              <div className="flex items-start justify-between mb-2 relative z-10">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{
                    background: isDone ? 'rgba(16,185,129,0.2)' : `${scenario.color}20`,
                  }}
                >
                  {isDone ? (
                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Icon className="h-4 w-4" style={{ color: scenario.color }} />
                  )}
                </div>
                {isRunning && (
                  <div
                    className="w-2 h-2 rounded-full animate-ping"
                    style={{ background: scenario.color }}
                  />
                )}
                {isActiveInSeq && !isRunning && (
                  <div
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: scenario.color, color: 'white' }}
                  >
                    NEXT
                  </div>
                )}
              </div>

              <p className="font-bold text-sm relative z-10" style={{ color: isDone ? '#10b981' : 'var(--text-primary)' }}>
                {scenario.label}
              </p>
              <p className="text-[10px] mt-0.5 relative z-10" style={{ color: 'var(--text-muted)' }}>
                {scenario.description}
              </p>
            </button>
          )
        })}
      </div>

      {/* Full Sequence Button */}
      <div className="px-4 pb-4">
        {!fullSequence ? (
          <button
            onClick={runFullSequence}
            disabled={!!running}
            className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl font-black text-sm uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #7c3aed, #dc2626)',
              color: 'white',
              boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
            }}
          >
            <Play className="h-4 w-4" />
            Run Full Demo Sequence
          </button>
        ) : (
          <button
            onClick={stopSequence}
            className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl font-black text-sm uppercase tracking-widest transition-all hover:scale-[1.02]"
            style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
          >
            <X className="h-4 w-4" />
            Stop Sequence ({sequenceStep + 1}/{SCENARIOS.length})
          </button>
        )}
      </div>

      {/* Activity Log */}
      {log.length > 0 && (
        <div
          className="mx-4 mb-4 rounded-xl p-3 font-mono text-[10px] space-y-1 max-h-32 overflow-y-auto"
          style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          {log.map((entry, i) => (
            <div key={i} style={{ color: entry.startsWith('✅') ? '#10b981' : entry.startsWith('❌') ? '#ef4444' : entry.startsWith('⚠') ? '#f59e0b' : '#94a3b8' }}>
              {entry}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
