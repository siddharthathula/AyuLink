'use client'

import { useState } from 'react'
import { UserCheck, MapPin, Clock, CheckCircle, AlertCircle, Phone, LogIn, LogOut, Check } from 'lucide-react'
import { useTheme } from '@/lib/theme-context'

interface ASHAVisit {
    id: string
    patientName: string
    patientId: string
    village: string
    visitType: 'routine' | 'emergency' | 'followup'
    scheduledTime: string
    actualTime?: string
    status: 'pending' | 'completed' | 'missed'
    notes?: string
}

// Initial Mock Tasks for Swarupa
const initialTasks: ASHAVisit[] = [
    { id: 'V-001', patientName: 'Ramulu Goud', patientId: '108', village: 'Hanamkonda', visitType: 'routine', scheduledTime: '09:00', status: 'pending' },
    { id: 'V-002', patientName: 'Ramulu Goud', patientId: '108', village: 'Hanamkonda', visitType: 'followup', scheduledTime: '14:00', status: 'pending' },
]

export default function ASHAPortal() {
    const { t } = useTheme()
    const [isLoggedIn, setIsLoggedIn] = useState(false)
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    
    // Task State
    const [tasks, setTasks] = useState<ASHAVisit[]>(initialTasks)
    const [syncingId, setSyncingId] = useState<string | null>(null)

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault()
        if (username.toLowerCase() === 'swarupa' && password === '1234') {
            setIsLoggedIn(true)
            setError('')
        } else {
            setError('Invalid ASHA credentials. Try swarupa / 1234')
        }
    }

    const markTaskDone = (taskId: string) => {
        setSyncingId(taskId)
        // Simulate network sync
        setTimeout(() => {
            setTasks(prev => prev.map(t => 
                t.id === taskId ? { ...t, status: 'completed', actualTime: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) } : t
            ))
            setSyncingId(null)
        }, 800)
    }

    if (!isLoggedIn) {
        return (
            <div className="min-h-[80vh] flex items-center justify-center p-4">
                <div className="card p-8 w-full max-w-md animate-fadeInUp">
                    <div className="flex justify-center mb-6">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
                            <UserCheck className="h-8 w-8 text-white" />
                        </div>
                    </div>
                    <h2 className="text-2xl font-black text-center mb-2" style={{ color: 'var(--text-primary)' }}>
                        ASHA Worker Portal
                    </h2>
                    <p className="text-center mb-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                        Login to view and sync your assigned patient visits.
                    </p>

                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>ASHA ID</label>
                            <input 
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/50"
                                style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                                placeholder="e.g. swarupa"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Security PIN</label>
                            <input 
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border outline-none focus:ring-2 focus:ring-violet-500/50"
                                style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                                placeholder="****"
                                required
                            />
                        </div>

                        {error && (
                            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-2 text-red-500 text-sm">
                                <AlertCircle className="h-4 w-4" /> {error}
                            </div>
                        )}

                        <button type="submit" className="w-full py-3 mt-4 rounded-xl font-bold flex items-center justify-center gap-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-lg hover:shadow-xl transition-all hover:-translate-y-1">
                            <LogIn className="h-5 w-5" /> Secure Login
                        </button>
                    </form>
                </div>
            </div>
        )
    }

    const pendingTasks = tasks.filter(t => t.status === 'pending')
    const completedTasks = tasks.filter(t => t.status === 'completed')

    const getVisitTypeColor = (type: string) => {
        switch (type) {
            case 'emergency': return 'bg-red-500'
            case 'followup': return 'bg-blue-500'
            default: return 'bg-teal-500'
        }
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/30">
                        <UserCheck className="h-8 w-8 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>Welcome, Swarupa! 👋</h1>
                        <p className="font-semibold" style={{ color: 'var(--text-muted)' }}>You have {pendingTasks.length} pending visits today.</p>
                    </div>
                </div>
                <button 
                    onClick={() => setIsLoggedIn(false)}
                    className="px-4 py-2 rounded-xl text-sm font-bold border hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition-colors"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                >
                    <LogOut className="h-4 w-4" /> Logout
                </button>
            </div>

            {/* Dashboard Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="card p-5">
                    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Assigned Area</p>
                    <p className="text-xl font-black mt-1" style={{ color: 'var(--text-primary)' }}>Hanamkonda</p>
                </div>
                <div className="card p-5 border-l-4 border-amber-500">
                    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Pending Tasks</p>
                    <p className="text-3xl font-black mt-1 text-amber-500">{pendingTasks.length}</p>
                </div>
                <div className="card p-5 border-l-4 border-emerald-500">
                    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Completed</p>
                    <p className="text-3xl font-black mt-1 text-emerald-500">{completedTasks.length}</p>
                </div>
            </div>

            {/* Tasks List */}
            <div className="card">
                <div className="p-5 border-b" style={{ borderColor: 'var(--border-color)' }}>
                    <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Today's Assigned Route</h2>
                </div>
                <div className="p-5 space-y-3">
                    {tasks.length === 0 ? (
                        <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No tasks assigned for today.</p>
                    ) : (
                        tasks.map((task) => (
                            <div key={task.id} className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${task.status === 'completed' ? 'opacity-60 bg-black/5 dark:bg-white/5' : ''}`} style={{ borderColor: 'var(--border-color)', background: task.status === 'pending' ? 'var(--bg-secondary)' : undefined }}>
                                
                                <div className="flex items-start gap-4">
                                    <div className={`w-2 h-12 rounded-full mt-1 ${getVisitTypeColor(task.visitType)}`} />
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{task.patientName}</p>
                                            <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
                                                {task.visitType}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs mt-1 font-semibold" style={{ color: 'var(--text-muted)' }}>
                                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-red-400" /> {task.village}</span>
                                            <span className="flex items-center gap-1"><Clock className="h-3 w-3 text-blue-400" /> {task.scheduledTime}</span>
                                            <span className="flex items-center gap-1"><UserCheck className="h-3 w-3 text-emerald-400" /> ID: {task.patientId}</span>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    {task.status === 'completed' ? (
                                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                                            <CheckCircle className="h-5 w-5" /> Synced at {task.actualTime}
                                        </div>
                                    ) : (
                                        <button 
                                            onClick={() => markTaskDone(task.id)}
                                            disabled={syncingId === task.id}
                                            className="w-full md:w-auto px-6 py-2.5 rounded-xl bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 hover:bg-emerald-600 transition-colors disabled:opacity-50"
                                        >
                                            {syncingId === task.id ? (
                                                <span className="animate-pulse">Syncing...</span>
                                            ) : (
                                                <><Check className="h-5 w-5" /> Mark Completed</>
                                            )}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    )
}
