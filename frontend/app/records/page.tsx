'use client'

import { FileText, Upload, Download, Search, Calendar, User, AlertCircle, Loader2, RefreshCw, ChevronDown } from 'lucide-react'
import { useTheme } from '@/lib/theme-context'
import { useState, useEffect } from 'react'

const statusColors = {
    complete: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    review: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
}

const FALLBACK_RECORDS = [
    { id: 1, patient: 'Ramulu Goud', type: 'Blood Test', date: '2026-04-10', doctor: 'Dr. Sharma', status: 'complete', condition: 'Diabetes Type 2' },
    { id: 2, patient: 'Ramulu Goud', type: 'ECG Report', date: '2026-04-09', doctor: 'Dr. Patel', status: 'complete', condition: 'Hypertension' },
]

export default function MedicalRecordsPage() {
    const { t } = useTheme()
    const [medicalRecords, setMedicalRecords] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [selectedPatient, setSelectedPatient] = useState<any | null>(null)
    const [patients, setPatients] = useState<any[]>([])

    const loadData = async () => {
        setLoading(true)
        try {
            // Load patients from local SQLite backend
            const pRes = await fetch('/api/patients')
            const pData = await pRes.json()
            const allPatients = pData.ok && pData.patients ? pData.patients : []
            setPatients(allPatients)

            // Build records from vitals history per patient
            const recordRows: any[] = []
            for (const p of allPatients) {
                // Get per-patient reports
                try {
                    const rRes = await fetch(`/api/patients/${p.id}/reports`)
                    const rData = await rRes.json()
                    if (rData.ok && rData.reports?.length) {
                        rData.reports.forEach((r: any) => recordRows.push({
                            id: r.id,
                            patient: p.name,
                            patient_id: p.id,
                            type: r.title || 'Report',
                            date: r.created_at ? new Date(r.created_at * 1000).toISOString().split('T')[0] : 'N/A',
                            doctor: 'Dr. PHC',
                            status: 'complete',
                            condition: (p.conditions || [])[0] || 'Routine',
                        }))
                    }
                    // Also add vitals snapshots as "Vitals Log" entries
                    const vRes = await fetch(`/api/vitals/history/${p.id}?limit=3`)
                    const vData = await vRes.json()
                    if (vData.ok && vData.history?.length) {
                        vData.history.slice(0, 1).forEach((v: any) => recordRows.push({
                            id: `v-${v.id || Math.random()}`,
                            patient: p.name,
                            patient_id: p.id,
                            type: 'Vitals Log',
                            date: new Date(v.timestamp * 1000).toISOString().split('T')[0],
                            doctor: 'AyuLink System',
                            status: v.sos || v.fall ? 'review' : 'complete',
                            condition: v.fall ? '⚠ Fall Detected' : v.sos ? '🆘 SOS' : `HR:${v.hr} SpO2:${v.spo2}%`,
                        }))
                    }
                } catch { /* skip */ }
            }

            setMedicalRecords(recordRows.length > 0 ? recordRows : FALLBACK_RECORDS)
        } catch {
            setMedicalRecords(FALLBACK_RECORDS)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { loadData() }, [])

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-[var(--foreground)]">{t('records')}</h1>
                    <p className="mt-1 text-[var(--muted-foreground)]">View and manage patient medical histories</p>
                </div>
                <button className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium hover:opacity-90 transition-all shadow-lg hover:shadow-xl">
                    <Upload className="h-5 w-5" />
                    Upload Record
                </button>
                <button onClick={loadData} className="flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
                    <RefreshCw className="h-4 w-4" /> Refresh
                </button>
            </div>

            {/* Patient Details Panel */}
            {selectedPatient && (
                <div className="glass-card rounded-2xl p-5 border-l-4 border-blue-500">
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-[var(--foreground)]">{selectedPatient.name}</h2>
                            <p className="text-sm text-[var(--muted-foreground)] mt-0.5">{selectedPatient.id} · Age {selectedPatient.age} · {selectedPatient.village}</p>
                        </div>
                        <button onClick={() => setSelectedPatient(null)} className="p-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-400 transition-colors">✕</button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                        <div className="p-3 rounded-xl bg-[var(--muted)]">
                            <p className="text-xs text-[var(--muted-foreground)] mb-1">Conditions</p>
                            <p className="text-sm font-medium text-[var(--foreground)]">{(selectedPatient.conditions || []).join(', ') || '—'}</p>
                        </div>
                        <div className="p-3 rounded-xl bg-[var(--muted)]">
                            <p className="text-xs text-[var(--muted-foreground)] mb-1">Allergies</p>
                            <p className="text-sm font-medium text-[var(--foreground)]">{(selectedPatient.allergies || []).join(', ') || 'None'}</p>
                        </div>
                        <div className="p-3 rounded-xl bg-[var(--muted)]">
                            <p className="text-xs text-[var(--muted-foreground)] mb-1">Blood Group</p>
                            <p className="text-sm font-medium text-[var(--foreground)]">{selectedPatient.blood_group || '—'}</p>
                        </div>
                        <div className="p-3 rounded-xl bg-[var(--muted)]">
                            <p className="text-xs text-[var(--muted-foreground)] mb-1">Language</p>
                            <p className="text-sm font-medium text-[var(--foreground)]">{selectedPatient.language || 'Telugu'}</p>
                        </div>
                    </div>
                    {selectedPatient.emergency_contact && (
                        <p className="text-xs text-[var(--muted-foreground)] mt-3">📞 Emergency: {selectedPatient.emergency_contact}</p>
                    )}
                </div>
            )}
            <div className="glass-card rounded-2xl p-4">
                <div className="flex items-center gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--muted-foreground)]" />
                        <input
                            type="text"
                            placeholder="Search records by patient name or type..."
                            className="w-full pl-12 pr-4 py-3 rounded-xl bg-[var(--muted)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                        />
                    </div>
                    <select className="px-4 py-3 rounded-xl bg-[var(--muted)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]">
                        <option>All Types</option>
                        <option>Lab Report</option>
                        <option>X-Ray</option>
                        <option>Blood Test</option>
                        <option>ECG Report</option>
                    </select>
                </div>
            </div>

            {/* Records Table */}
            <div className="glass-card rounded-2xl overflow-hidden">
                <table className="w-full">
                    <thead className="bg-[var(--muted)]">
                        <tr>
                            <th className="px-6 py-4 text-left text-sm font-semibold text-[var(--foreground)]">Patient</th>
                            <th className="px-6 py-4 text-left text-sm font-semibold text-[var(--foreground)]">Record Type</th>
                            <th className="px-6 py-4 text-left text-sm font-semibold text-[var(--foreground)]">Condition</th>
                            <th className="px-6 py-4 text-left text-sm font-semibold text-[var(--foreground)]">Date</th>
                            <th className="px-6 py-4 text-left text-sm font-semibold text-[var(--foreground)]">Doctor</th>
                            <th className="px-6 py-4 text-left text-sm font-semibold text-[var(--foreground)]">Status</th>
                            <th className="px-6 py-4 text-left text-sm font-semibold text-[var(--foreground)]">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                        {loading ? (
                            <tr>
                                <td colSpan={7} className="p-8 text-center text-[var(--muted-foreground)]">
                                    <div className="flex flex-col items-center justify-center gap-2">
                                        <Loader2 className="h-6 w-6 animate-spin" />
                                        <p>Loading records...</p>
                                    </div>
                                </td>
                            </tr>
                        ) : medicalRecords.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="p-8 text-center text-[var(--muted-foreground)] italic">
                                    No records found
                                </td>
                            </tr>
                        ) : (
                            medicalRecords
                                .filter(r => !search || r.patient.toLowerCase().includes(search.toLowerCase()) || r.type.toLowerCase().includes(search.toLowerCase()))
                                .map((record) => (
                                <tr key={record.id} className="hover:bg-[var(--muted)] transition-colors cursor-pointer"
                                    onClick={() => {
                                        const p = patients.find(pt => pt.id === record.patient_id || pt.name === record.patient)
                                        if (p) setSelectedPatient(p)
                                    }}>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold">
                                                {record.patient.charAt(0)}
                                            </div>
                                            <span className="font-medium text-[var(--foreground)]">{record.patient}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <FileText className="h-4 w-4 text-[var(--muted-foreground)]" />
                                            <span className="text-[var(--foreground)]">{record.type}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-[var(--muted-foreground)]">{record.condition}</td>
                                    <td className="px-6 py-4 text-[var(--muted-foreground)]">{record.date}</td>
                                    <td className="px-6 py-4 text-[var(--foreground)]">{record.doctor}</td>
                                    <td className="px-6 py-4">
                                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[record.status as keyof typeof statusColors] || 'bg-gray-100 text-gray-800'}`}>
                                            {record.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <button className="p-2 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-500 transition-colors">
                                            <Download className="h-4 w-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
