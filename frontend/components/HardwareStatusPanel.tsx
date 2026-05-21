'use client'

import { useState, useEffect, useRef } from 'react'
import { Wifi, WifiOff, Battery, Signal, Cpu, Camera, Radio, Flame, Wind, Activity, Pill, Thermometer, Zap } from 'lucide-react'

interface HardwareDevice {
  id: string
  name: string
  type: 'wristband' | 'gateway' | 'hub' | 'camera'
  online: boolean
  rssi?: number
  battery?: number
  lastSeen?: number
  vitals?: { hr?: number; spo2?: number; temp?: number }
  hubData?: {
    air_ppm?: number
    flame?: boolean
    env_temp?: number     // DHT11 room temperature
    humidity?: number     // DHT11 humidity
    rtc_time?: string     // DS3231 RTC time string
    pill_slot1?: boolean
    pill_slot2?: boolean
    pill_slot3?: boolean
    pill_slot4?: boolean
  }
}

function SignalBars({ rssi }: { rssi: number }) {
  // rssi typically -100 (worst) to -30 (best)
  const strength = rssi >= -50 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : 1
  return (
    <div className="flex items-end gap-[2px] h-4">
      {[1, 2, 3, 4].map(b => (
        <div
          key={b}
          className="w-[3px] rounded-sm transition-all"
          style={{
            height: `${b * 25}%`,
            background: b <= strength
              ? strength >= 3 ? '#10b981' : strength >= 2 ? '#f59e0b' : '#ef4444'
              : 'rgba(148,163,184,0.3)'
          }}
        />
      ))}
    </div>
  )
}

function PulsingDot({ online }: { online: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
      {online && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#10b981' }} />
      )}
      <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: online ? '#10b981' : '#64748b' }} />
    </span>
  )
}

export default function HardwareStatusPanel() {
  const [devices, setDevices] = useState<HardwareDevice[]>([
    {
      id: 'wristband_P01',
      name: 'Wristband — P_01',
      type: 'wristband',
      online: false,
      rssi: -72,
      battery: 78,
      lastSeen: Date.now(),
      vitals: { hr: 0, spo2: 0, temp: 0 },
    },
    {
      id: 'gateway',
      name: 'LoRa Gateway',
      type: 'gateway',
      online: false,
      rssi: -55,
      lastSeen: Date.now(),
    },
    {
      id: 'hub',
      name: 'NodeMCU Hub (OLED)',
      type: 'hub',
      online: false,
      rssi: -40,
      lastSeen: Date.now(),
      hubData: {
        air_ppm: 0, flame: false,
        env_temp: 0, humidity: 0, rtc_time: '',
        pill_slot1: false, pill_slot2: false, pill_slot3: false, pill_slot4: false,
      },
    },
    {
      id: 'camera',
      name: 'ESP32-CAM',
      type: 'camera',
      online: false,
      lastSeen: Date.now(),
    },
  ])

  const [gatewayConnected, setGatewayConnected] = useState(false)
  const [hubOnline, setHubOnline] = useState(false)
  const [uptime, setUptime] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    // Skip backend calls on Vercel / any non-localhost deploy
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return

    const backendUrl = `http://${window.location.hostname}:8000`

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${backendUrl}/api/status`)
        const data = await res.json()

        const gwConnected = data.gateway_connected ?? false
        setGatewayConnected(gwConnected)

        // Update gateway status
        setDevices(prev => prev.map(d => {
          if (d.id === 'gateway') return { ...d, online: gwConnected, lastSeen: gwConnected ? Date.now() : d.lastSeen }
          return d
        }))
      } catch { /* offline */ }

      try {
        const hubRes = await fetch(`${backendUrl}/api/hub`)
        const hubData = await hubRes.json()

        setHubOnline(hubData.online ?? false)
        setDevices(prev => prev.map(d => {
          if (d.id === 'hub') {
            return {
              ...d,
              online: hubData.online ?? false,
              rssi: hubData.rssi ?? d.rssi,
              hubData: {
                air_ppm: hubData.air_ppm,
                flame: hubData.flame,
                env_temp: hubData.env_temp ?? 0,
                humidity: hubData.humidity ?? 0,
                rtc_time: hubData.rtc_time ?? '',
                pill_slot1: hubData.pill_slot1,
                pill_slot2: hubData.pill_slot2,
                pill_slot3: hubData.pill_slot3,
                pill_slot4: hubData.pill_slot4,
              },
              lastSeen: hubData.online ? Date.now() : d.lastSeen,
            }
          }
          return d
        }))
      } catch { /* hub offline */ }

      try {
        const pRes = await fetch(`${backendUrl}/api/live/patients`)
        const patients: any[] = await pRes.json()
        const now = Date.now()

        setDevices(prev => {
          const updated = [...prev]
          patients.forEach(p => {
            const isOnline = p.status !== 'offline' && (now - p.last_seen * 1000) < 30000
            
            // Find wristband by exact ID or just fallback to any wristband type
            let idx = updated.findIndex(d => d.id === `wristband_${p.id}`)
            if (idx === -1) idx = updated.findIndex(d => d.type === 'wristband')

            if (idx >= 0) {
              updated[idx] = {
                ...updated[idx],
                id: `wristband_${p.id}`,
                name: `Wristband — ${p.name || p.id}`,
                online: isOnline,
                rssi: p.rssi ?? updated[idx].rssi,
                vitals: { hr: p.hr, spo2: p.spo2, temp: p.temp },
                lastSeen: isOnline ? now : updated[idx].lastSeen,
              }
            }
          })

          // Tie ESP32-CAM online status to the Hub, as they are physically connected
          const hubIdx = updated.findIndex(d => d.type === 'hub')
          const camIdx = updated.findIndex(d => d.type === 'camera')
          if (hubIdx >= 0 && camIdx >= 0) {
            updated[camIdx] = {
              ...updated[camIdx],
              online: updated[hubIdx].online,
              lastSeen: updated[hubIdx].online ? now : updated[camIdx].lastSeen,
            }
          }

          return updated
        })
      } catch { /* ok */ }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  // WebSocket for real-time updates
  useEffect(() => {
    // Skip on Vercel / non-localhost
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return
    const wsUrl = `ws://${window.location.hostname}:8000/ws/dashboard`
    let ws: WebSocket
    let dead = false

    const connect = () => {
      if (dead) return
      ws = new WebSocket(wsUrl)

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)

          if (msg.event === 'vital') {
            const d = msg.data
            setDevices(prev => prev.map(dev => {
              if (dev.id === `wristband_${d.patient_id}` || dev.type === 'wristband') {
                return {
                  ...dev,
                  online: d.worn !== false,
                  rssi: d.rssi ?? dev.rssi,
                  vitals: { hr: d.hr, spo2: d.spo2, temp: d.temp },
                  lastSeen: Date.now(),
                }
              }
              return dev
            }))
          }

          if (msg.event === 'hub') {
            const d = msg.data
            setDevices(prev => prev.map(dev => {
              if (dev.id === 'hub') {
                return {
                  ...dev,
                  online: true,
                  rssi: d.rssi ?? dev.rssi,
                  hubData: {
                    air_ppm: d.air_ppm,
                    flame: d.flame,
                    env_temp: d.env_temp ?? 0,
                    humidity: d.humidity ?? 0,
                    rtc_time: d.rtc_time ?? '',
                    pill_slot1: d.pill_slot1,
                    pill_slot2: d.pill_slot2,
                    pill_slot3: d.pill_slot3,
                    pill_slot4: d.pill_slot4,
                  },
                  lastSeen: Date.now(),
                }
              }
              return dev
            }))
          }

          if (msg.event === 'gateway_status') {
            const online = msg.data.connected
            setDevices(prev => prev.map(dev => {
              if (dev.id === 'gateway') return { ...dev, online, lastSeen: online ? Date.now() : dev.lastSeen }
              return dev
            }))
          }
        } catch { /* ignore */ }
      }

      ws.onclose = () => { if (!dead) setTimeout(connect, 2000) }
      ws.onerror = () => ws.close()
    }

    connect()
    return () => { dead = true; ws?.close() }
  }, [])

  // Uptime counter
  useEffect(() => {
    const t = setInterval(() => setUptime(u => u + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const onlineCount = devices.filter(d => d.online).length
  const totalCount = devices.length

  const getDeviceIcon = (type: HardwareDevice['type'], online: boolean) => {
    const cls = `h-5 w-5 ${online ? 'text-white' : 'text-slate-400'}`
    switch (type) {
      case 'wristband': return <Activity className={cls} />
      case 'gateway': return <Radio className={cls} />
      case 'hub': return <Cpu className={cls} />
      case 'camera': return <Camera className={cls} />
    }
  }

  const getDeviceGradient = (type: HardwareDevice['type'], online: boolean) => {
    if (!online) return 'bg-slate-700/50'
    switch (type) {
      case 'wristband': return 'bg-gradient-to-br from-pink-500 to-rose-600'
      case 'gateway': return 'bg-gradient-to-br from-blue-500 to-indigo-600'
      case 'hub': return 'bg-gradient-to-br from-emerald-500 to-teal-600'
      case 'camera': return 'bg-gradient-to-br from-violet-500 to-purple-600'
    }
  }

  const formatUptime = (secs: number) => {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  return (
    <div
      className="card animate-fadeInUp"
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
    >
      {/* Header */}
      <div className="p-5 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
              <Wifi className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Hardware Network</h2>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {onlineCount}/{totalCount} devices online · Uptime {formatUptime(uptime)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="px-3 py-1.5 rounded-xl text-xs font-bold"
              style={{
                background: onlineCount > 0 ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.2)',
                color: onlineCount > 0 ? '#10b981' : '#94a3b8',
                border: `1px solid ${onlineCount > 0 ? 'rgba(16,185,129,0.3)' : 'rgba(100,116,139,0.3)'}`,
              }}
            >
              {onlineCount > 0 ? `${onlineCount} ONLINE` : 'OFFLINE'}
            </div>
          </div>
        </div>
      </div>

      {/* Devices Grid */}
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {devices.map((device) => (
          <div
            key={device.id}
            className="rounded-2xl p-4 transition-all duration-300 relative overflow-hidden group flex flex-col h-full"
            style={{
              background: device.online ? 'var(--bg-primary)' : 'rgba(30,41,59,0.4)',
              border: `1px solid ${device.online ? 'rgba(16,185,129,0.25)' : 'rgba(100,116,139,0.2)'}`,
              boxShadow: device.online ? '0 0 20px rgba(16,185,129,0.08)' : 'none',
            }}
          >
            {/* Online glow */}
            {device.online && (
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-2xl" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(16,185,129,0.06) 0%, transparent 70%)' }} />
            )}

            {/* Decorative Background Watermarks to fill empty vertical space */}
            {device.type === 'gateway' && <Radio className="absolute -bottom-6 -right-6 w-40 h-40 opacity-[0.04] text-white pointer-events-none transform -rotate-12" />}
            {device.type === 'camera' && <Camera className="absolute -bottom-6 -right-6 w-40 h-40 opacity-[0.04] text-white pointer-events-none transform -rotate-12" />}
            {device.type === 'wristband' && <Activity className="absolute -bottom-6 -right-6 w-40 h-40 opacity-[0.04] text-white pointer-events-none transform -rotate-12" />}
            {device.type === 'hub' && <Cpu className="absolute -bottom-6 -right-6 w-40 h-40 opacity-[0.04] text-white pointer-events-none transform -rotate-12" />}

            <div className="relative z-10 flex flex-col flex-1">
              <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${getDeviceGradient(device.type, device.online)}`}
                  style={{ boxShadow: device.online ? '0 4px 12px rgba(0,0,0,0.3)' : 'none' }}
                >
                  {getDeviceIcon(device.type, device.online)}
                </div>
                <div>
                  <p className="font-bold text-sm leading-tight" style={{ color: 'var(--text-primary)' }}>{device.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <PulsingDot online={device.online} />
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: device.online ? '#10b981' : '#64748b' }}>
                      {device.online ? 'Connected' : 'Offline'}
                    </span>
                  </div>
                </div>
              </div>

              {device.rssi !== undefined && device.online && (
                <div className="flex items-center gap-1.5">
                  <SignalBars rssi={device.rssi} />
                  <span className="text-[10px] font-mono text-slate-500">{device.rssi}dB</span>
                </div>
              )}
            </div>

            {/* Wristband vitals mini-display */}
            {device.type === 'wristband' && device.vitals && device.online && (
              <div className="grid grid-cols-3 gap-1.5 mt-2">
                <div className="rounded-lg p-1.5 text-center" style={{ background: 'var(--bg-secondary)' }}>
                  <p className="text-[10px] font-bold text-rose-400">HR</p>
                  <p className="text-sm font-black" style={{ color: device.vitals.hr! > 100 ? '#ef4444' : 'var(--text-primary)' }}>
                    {device.vitals.hr || '—'}
                  </p>
                  <p className="text-[9px] text-slate-500">bpm</p>
                </div>
                <div className="rounded-lg p-1.5 text-center" style={{ background: 'var(--bg-secondary)' }}>
                  <p className="text-[10px] font-bold text-blue-400">SpO₂</p>
                  <p className="text-sm font-black" style={{ color: (device.vitals.spo2 || 100) < 90 ? '#ef4444' : 'var(--text-primary)' }}>
                    {device.vitals.spo2 || '—'}%
                  </p>
                  <p className="text-[9px] text-slate-500">O₂</p>
                </div>
                <div className="rounded-lg p-1.5 text-center" style={{ background: 'var(--bg-secondary)' }}>
                  <p className="text-[10px] font-bold text-orange-400">Temp</p>
                  <p className="text-sm font-black" style={{ color: (device.vitals.temp || 37) > 37.5 ? '#f59e0b' : 'var(--text-primary)' }}>
                    {device.vitals.temp ? parseFloat(device.vitals.temp.toFixed(1)) : '—'}°
                  </p>
                  <p className="text-[9px] text-slate-500">°C</p>
                </div>
              </div>
            )}

            {/* Hub sensor mini-display */}
            {device.type === 'hub' && device.hubData && (
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1">
                    <Wind className="h-3 w-3 text-cyan-400" />
                    <span style={{ color: 'var(--text-muted)' }}>Air Quality</span>
                  </div>
                  <span className="font-bold" style={{
                    color: (device.hubData.air_ppm || 0) > 300 ? '#ef4444' : (device.hubData.air_ppm || 0) > 150 ? '#f59e0b' : '#10b981'
                  }}>
                    {device.hubData.air_ppm || 0} PPM
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1">
                    <Flame className="h-3 w-3 text-orange-400" />
                    <span style={{ color: 'var(--text-muted)' }}>Flame Sensor</span>
                  </div>
                  <span className="font-bold" style={{ color: device.hubData.flame ? '#ef4444' : '#10b981' }}>
                    {device.hubData.flame ? '🔥 DETECTED' : 'Clear'}
                  </span>
                </div>
                {(device.hubData.env_temp || 0) > 0 && (
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1">
                      <Thermometer className="h-3 w-3 text-orange-400" />
                      <span style={{ color: 'var(--text-muted)' }}>Room Temp (DHT11)</span>
                    </div>
                    <span className="font-bold text-orange-400">{device.hubData.env_temp?.toFixed(1)}°C</span>
                  </div>
                )}
                {(device.hubData.humidity || 0) > 0 && (
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1">
                      <Zap className="h-3 w-3 text-blue-400" />
                      <span style={{ color: 'var(--text-muted)' }}>Humidity (DHT11)</span>
                    </div>
                    <span className="font-bold text-blue-400">{device.hubData.humidity?.toFixed(1)}%</span>
                  </div>
                )}
                {device.hubData.rtc_time && (
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1">
                      <Radio className="h-3 w-3 text-violet-400" />
                      <span style={{ color: 'var(--text-muted)' }}>RTC (DS3231)</span>
                    </div>
                    <span className="font-bold text-violet-400">{device.hubData.rtc_time}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1">
                    <Pill className="h-3 w-3 text-purple-400" />
                    <span style={{ color: 'var(--text-muted)' }}>Pill Slots</span>
                  </div>
                  <div className="flex gap-1">
                    {['AM', 'PM', 'Eve', 'Ngt'].map((label, i) => {
                      const slots = [device.hubData!.pill_slot1, device.hubData!.pill_slot2, device.hubData!.pill_slot3, device.hubData!.pill_slot4]
                      return (
                        <span
                          key={i}
                          className="text-[9px] font-bold px-1 py-0.5 rounded"
                          style={{
                            background: slots[i] ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.2)',
                            color: slots[i] ? '#10b981' : '#64748b',
                          }}
                        >
                          {label}
                        </span>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Gateway LoRa info */}
            {device.type === 'gateway' && device.online && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                <Radio className="h-3 w-3 text-blue-400" />
                <span>LoRa 433MHz · WebSocket bridge active</span>
              </div>
            )}

            {/* Camera feed hint */}
            {device.type === 'camera' && (
              <div className="mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                <div className="flex items-center gap-1.5">
                  <Camera className="h-3 w-3 text-violet-400" />
                  <span>MJPEG stream · Set URL in Dispensers</span>
                </div>
              </div>
            )}

            {/* Last seen */}
            {!device.online && device.lastSeen && (
              <p suppressHydrationWarning className="text-[10px] mt-2 font-medium" style={{ color: '#64748b' }}>
                Last seen: {new Date(device.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
            </div>{/* close flex-col flex-1 inner wrapper */}
          </div>
        ))}
      </div>

      {/* System Health Bar */}
      <div className="mx-4 mb-4 p-3 rounded-xl" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
        <div className="flex items-center justify-between text-[11px] font-bold mb-2" style={{ color: 'var(--text-muted)' }}>
          <span>NETWORK HEALTH</span>
          <span style={{ color: onlineCount >= 3 ? '#10b981' : onlineCount >= 1 ? '#f59e0b' : '#ef4444' }}>
            {Math.round((onlineCount / totalCount) * 100)}%
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full" style={{ background: 'rgba(100,116,139,0.2)' }}>
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${(onlineCount / totalCount) * 100}%`,
              background: onlineCount >= 3 ? 'linear-gradient(to right, #10b981, #34d399)' : onlineCount >= 1 ? 'linear-gradient(to right, #f59e0b, #fcd34d)' : '#ef4444',
              boxShadow: onlineCount >= 3 ? '0 0 8px rgba(16,185,129,0.5)' : 'none',
            }}
          />
        </div>
      </div>
    </div>
  )
}
