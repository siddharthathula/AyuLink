'use client'

import React, { useState, useEffect } from 'react'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    LineChart,
    Line,
    AreaChart,
    Area,
} from 'recharts'
import { Users, AlertTriangle, CheckCircle, Activity, Calendar } from 'lucide-react'
import { useTheme } from '@/lib/theme-context'
import { supabase } from '@/lib/supabaseClient'
import { useDemoMode } from '@/lib/demo-context'

// --- Mock Data ---
const mockVillageData = [
    { name: 'Shadnagar', patients: 12, critical: 1, active: 10 },
    { name: 'Maheshwaram', patients: 18, critical: 2, active: 15 },
    { name: 'Shamshabad', patients: 8, critical: 0, active: 8 },
    { name: 'Chevella', patients: 15, critical: 1, active: 12 },
    { name: 'Ibrahimpatnam', patients: 22, critical: 3, active: 18 },
]

const mockStatusData = [
    { name: 'Normal', value: 45, color: '#10b981' }, // Emerald
    { name: 'Critical', value: 5, color: '#ef4444' }, // Red
    { name: 'Warning', value: 12, color: '#f59e0b' }, // Amber
    { name: 'Offline', value: 8, color: '#64748b' }, // Slate
]

const mockVisitData = [
    { day: 'Mon', scheduled: 12, completed: 10, missed: 2 },
    { day: 'Tue', scheduled: 15, completed: 14, missed: 1 },
    { day: 'Wed', scheduled: 10, completed: 9, missed: 1 },
    { day: 'Thu', scheduled: 18, completed: 16, missed: 2 },
    { day: 'Fri', scheduled: 14, completed: 14, missed: 0 },
    { day: 'Sat', scheduled: 8, completed: 7, missed: 1 },
    { day: 'Sun', scheduled: 5, completed: 5, missed: 0 },
]

const mockVitalsTrend = Array.from({ length: 24 }, (_, i) => ({
    time: `${i}:00`,
    avgHr: 72 + Math.random() * 5 - 2.5,
    avgSpo2: 97 + Math.random() * 2 - 1,
}))

export default function StatsDashboard() {
    const { isDemoMode } = useDemoMode()
    const { t } = useTheme()
    const [loading, setLoading] = useState(true)
    const [villageData, setVillageData] = useState(mockVillageData)
    const [statusData, setStatusData] = useState(mockStatusData)

    // KPI States
    const [totalPatients, setTotalPatients] = useState(75)
    const [criticalAlerts, setCriticalAlerts] = useState(5)
    const [todayVisits, setTodayVisits] = useState(14)
    const [complianceRate, setComplianceRate] = useState(92)

    useEffect(() => {
        const fetchStats = async () => {
            if (isDemoMode) {
                // Fetch from LocalStorage
                const savedPatients = localStorage.getItem('demo_patients')
                if (savedPatients) {
                    const patients = JSON.parse(savedPatients)
                    setTotalPatients(patients.length)
                    setCriticalAlerts(patients.filter((p: any) => p.status === 'critical').length)

                    // Update Status Pie Data based on real demo data
                    const statusCounts = {
                        normal: patients.filter((p: any) => p.status === 'normal' || p.status === 'stable').length,
                        critical: patients.filter((p: any) => p.status === 'critical').length,
                        warning: patients.filter((p: any) => p.status === 'warning').length,
                        offline: patients.filter((p: any) => p.status === 'offline').length
                    }

                    setStatusData([
                        { name: 'Normal', value: statusCounts.normal, color: '#10b981' },
                        { name: 'Critical', value: statusCounts.critical, color: '#ef4444' },
                        { name: 'Warning', value: statusCounts.warning, color: '#f59e0b' },
                        { name: 'Offline', value: statusCounts.offline, color: '#64748b' },
                    ])
                }
                setLoading(false)
                return
            }

            // Fetch real data from Supabase
            try {
                const { count: total, error: countError } = await supabase
                    .from('patients')
                    .select('*', { count: 'exact', head: true })

                if (total !== null) setTotalPatients(total)

                const { count: critical, error: criticalError } = await supabase
                    .from('patients')
                    .select('*', { count: 'exact', head: true })
                    .eq('status', 'critical')

                if (critical !== null) setCriticalAlerts(critical)

                // Fetch status distribution for Pie Chart
                const { data: patients } = await supabase
                    .from('patients')
                    .select('status')

                if (patients) {
                    const statusCounts = {
                        normal: patients.filter((p: any) => p.status === 'normal' || p.status === 'stable').length,
                        critical: patients.filter((p: any) => p.status === 'critical').length,
                        warning: patients.filter((p: any) => p.status === 'warning').length,
                        offline: patients.filter((p: any) => p.status === 'offline').length
                    }

                    setStatusData([
                        { name: 'Normal', value: statusCounts.normal, color: '#10b981' },
                        { name: 'Critical', value: statusCounts.critical, color: '#ef4444' },
                        { name: 'Warning', value: statusCounts.warning, color: '#f59e0b' },
                        { name: 'Offline', value: statusCounts.offline, color: '#64748b' },
                    ])
                }

            } catch (error) {
                console.error('Error fetching stats:', error)
            } finally {
                setLoading(false)
            }
        }

        fetchStats()
    }, [isDemoMode])

    return (
        <div className="space-y-6 p-2 animate-fadeIn">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent">
                        {t('analyticsDashboard')}
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400">
                        {t('realtimeInsights')}
                    </p>
                </div>
                <div className="flex gap-2">
                    <button className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                        {t('exportReport')}
                    </button>
                    <button className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium shadow-md hover:bg-teal-700 transition-colors">
                        {t('refreshData')}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <KPICard
                    title={t('totalPatientsStats')}
                    value={totalPatients}
                    icon={Users}
                    trend="+12% this month"
                    color="text-blue-600 bg-blue-100 dark:bg-blue-900/20"
                />
                <KPICard
                    title={t('criticalAlertsStats')}
                    value={criticalAlerts}
                    icon={AlertTriangle}
                    trend="5 active now"
                    color="text-red-600 bg-red-100 dark:bg-red-900/20"
                />
                <KPICard
                    title={t('visitsToday')}
                    value={todayVisits}
                    icon={Calendar}
                    trend="85% completed"
                    color="text-purple-600 bg-purple-100 dark:bg-purple-900/20"
                />
                <KPICard
                    title={t('avgAdherence')}
                    value={`${complianceRate}%`}
                    icon={Activity}
                    trend="+3% vs last week"
                    color="text-emerald-600 bg-emerald-100 dark:bg-emerald-900/20"
                />
            </div>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Village Distribution */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                    <h3 className="text-lg font-bold mb-6 text-slate-800 dark:text-slate-200">{t('patientDistribution')}</h3>
                    <div className="h-80 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={villageData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
                                <Tooltip
                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    cursor={{ fill: '#f1f5f9' }}
                                />
                                <Bar dataKey="patients" name="Total Patients" fill="#0d9488" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="critical" name="Critical Cases" fill="#ef4444" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Patient Status Pie */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                    <h3 className="text-lg font-bold mb-6 text-slate-800 dark:text-slate-200">{t('systemHealth')}</h3>
                    <div className="h-80 w-full flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={statusData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={80}
                                    outerRadius={110}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {statusData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend verticalAlign="bottom" height={36} iconType="circle" />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Charts Row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Visit Compliance */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                    <h3 className="text-lg font-bold mb-6 text-slate-800 dark:text-slate-200">{t('ashaVisitCompletion')}</h3>
                    <div className="h-80 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={mockVisitData}>
                                <defs>
                                    <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
                                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                <Area type="monotone" dataKey="completed" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorCompleted)" strokeWidth={3} />
                                <Area type="monotone" dataKey="missed" stroke="#ef4444" fill="none" strokeWidth={3} strokeDasharray="5 5" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Vitals Trends */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                    <h3 className="text-lg font-bold mb-6 text-slate-800 dark:text-slate-200">{t('heartRateTrend')}</h3>
                    <div className="h-80 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={mockVitalsTrend}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} dy={10} minTickGap={30} />
                                <YAxis domain={[60, 100]} axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
                                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                <Line type="basis" dataKey="avgHr" stroke="#f43f5e" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    )
}

function KPICard({ title, value, icon: Icon, trend, color }: { title: string, value: string | number, icon: any, trend: string, color: string }) {
    return (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 transition-all hover:shadow-md">
            <div className="flex justify-between items-start mb-4">
                <div>
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
                    <h3 className="text-3xl font-bold mt-1 text-slate-900 dark:text-white">{value}</h3>
                </div>
                <div className={`p-3 rounded-xl ${color}`}>
                    <Icon className="h-6 w-6" />
                </div>
            </div>
            <div className="flex items-center gap-2">
                <div className="px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 text-xs font-bold">
                    Use
                </div>
                <span className="text-xs text-slate-500">{trend}</span>
            </div>
        </div>
    )
}
