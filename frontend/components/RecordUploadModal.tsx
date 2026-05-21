'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Upload, FileText, Image as ImageIcon, Trash2, Loader2, Eye } from 'lucide-react'

interface PatientRecord {
    id: string
    title: string
    type: string
    content: string
    image_b64?: string
    created_at: number
}

interface RecordUploadModalProps {
    isOpen: boolean
    onClose: () => void
    patientId: string
    patientName: string
}

function getBackendUrl(path: string): string {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
    return `http://${host}:8000${path}`
}

export default function RecordUploadModal({ isOpen, onClose, patientId, patientName }: RecordUploadModalProps) {
    const [records, setRecords] = useState<PatientRecord[]>([])
    const [uploading, setUploading] = useState(false)
    const [loading, setLoading] = useState(true)
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string>('')
    const [metadata, setMetadata] = useState({
        category: 'Prescription',
        doctorName: '',
        recordDate: new Date().toISOString().split('T')[0]
    })

    useEffect(() => {
        if (isOpen && patientId) {
            fetchRecords()
            setSelectedFile(null)
            setPreviewUrl('')
            setMetadata({ category: 'Prescription', doctorName: '', recordDate: new Date().toISOString().split('T')[0] })
        }
    }, [isOpen, patientId])

    const fetchRecords = async () => {
        setLoading(true)
        try {
            const res = await fetch(getBackendUrl(`/api/patients/${patientId}/reports`))
            const data = await res.json()
            if (data.ok && data.reports) setRecords(data.reports)
        } catch {
            setRecords([])
        }
        setLoading(false)
    }

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const isImage = file.type.startsWith('image/')
        const isPdf = file.type === 'application/pdf'
        if (!isImage && !isPdf) { alert('Please upload an image (JPG/PNG) or a PDF file.'); return }
        if (file.size > 5 * 1024 * 1024) { alert('File too large. Maximum size is 5 MB.'); return }
        setSelectedFile(file)
        setPreviewUrl(isImage ? URL.createObjectURL(file) : '')
    }

    const handleUpload = async () => {
        if (!selectedFile) return
        setUploading(true)
        try {
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(reader.result as string)
                reader.onerror = reject
                reader.readAsDataURL(selectedFile)
            })
            const isPdf = selectedFile.type === 'application/pdf'
            const title = `${metadata.category}${metadata.doctorName ? ' — ' + metadata.doctorName : ''} (${metadata.recordDate})`
            const res = await fetch(getBackendUrl('/api/reports'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patient_id: patientId, title,
                    type: isPdf ? 'pdf' : 'image',
                    content: JSON.stringify({ category: metadata.category, doctor: metadata.doctorName, date: metadata.recordDate }),
                    image_b64: base64,
                }),
            })
            const data = await res.json()
            if (!data.ok) throw new Error(data.error || 'Upload failed')
            await fetchRecords()
            setSelectedFile(null)
            setPreviewUrl('')
            setMetadata(prev => ({ ...prev, doctorName: '' }))
        } catch (err: any) {
            alert(`Failed to upload: ${err.message || 'Unknown error'}. Make sure the backend is running.`)
        } finally {
            setUploading(false)
        }
    }

    const handleView = (record: PatientRecord) => {
        const dataUrl = record.image_b64 || ''
        if (!dataUrl) { alert('No file content found for this record.'); return }
        const win = window.open()
        if (!win) { alert('Popup blocked — allow popups for this site.'); return }
        if (dataUrl.startsWith('data:application/pdf')) {
            win.document.write(`<iframe src="${dataUrl}" style="width:100%;height:100vh;border:none;"></iframe>`)
        } else {
            win.document.write(`<body style="margin:0;background:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${dataUrl}" style="max-width:100%;max-height:100vh;object-fit:contain;" /></body>`)
        }
        win.document.title = record.title || 'Medical Record'
    }

    const handleDelete = async (recordId: string) => {
        if (!confirm('Are you sure you want to delete this record?')) return
        try {
            await fetch(getBackendUrl(`/api/reports/${recordId}`), { method: 'DELETE' })
            setRecords(prev => prev.filter(r => r.id !== recordId))
        } catch {
            alert('Failed to delete record. Is the backend running?')
        }
    }

    const [mounted, setMounted] = useState(false)
    useEffect(() => { setMounted(true); return () => setMounted(false) }, [])
    if (!isOpen || !mounted) return null

    // ── Shared inline style tokens that adapt to theme ──
    const card = { background: 'var(--bg-card)', border: '1px solid var(--border-color)' } as React.CSSProperties
    const secondary = { background: 'var(--bg-secondary)' } as React.CSSProperties
    const textPrimary = { color: 'var(--text-primary)' } as React.CSSProperties
    const textMuted = { color: 'var(--text-muted)' } as React.CSSProperties
    const borderColor = { borderColor: 'var(--border-color)' } as React.CSSProperties

    return createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-start justify-center z-[9999] p-4 pt-10 overflow-y-auto">
            <div className="rounded-2xl shadow-2xl max-w-4xl w-full my-4 flex flex-col animate-fadeIn relative overflow-hidden"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>

                {/* ── Header ── */}
                <div className="flex items-center justify-between p-6 sticky top-0 z-10 rounded-t-2xl"
                    style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)' }}>
                    <div>
                        <h2 className="text-xl font-bold" style={textPrimary}>Patient Records</h2>
                        <p className="text-sm mt-0.5" style={textMuted}>
                            Records for <span className="font-semibold text-teal-400">{patientName}</span>
                        </p>
                    </div>
                    <button onClick={onClose}
                        className="p-2 rounded-full transition-colors hover:bg-red-500/10 group">
                        <X className="h-6 w-6 text-slate-400 group-hover:text-red-400 transition-colors" />
                    </button>
                </div>

                {/* ── Body ── */}
                <div className="p-6 overflow-y-auto max-h-[75vh]" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--border-color) transparent' }}>

                    {/* Upload Zone */}
                    <div className="mb-8 p-6 rounded-2xl border-2 border-dashed transition-colors"
                        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                        {!selectedFile ? (
                            <label className="flex flex-col items-center justify-center w-full h-32 cursor-pointer rounded-xl group relative overflow-hidden transition-all hover:border-teal-500/40">
                                <div className="absolute inset-0 bg-teal-500/0 group-hover:bg-teal-500/5 transition-colors rounded-xl" />
                                <div className="p-4 rounded-full shadow-lg mb-3 group-hover:scale-110 transition-transform"
                                    style={{ background: 'var(--bg-card)' }}>
                                    <Upload className="h-6 w-6 text-teal-400" />
                                </div>
                                <span className="text-sm font-bold z-10" style={textPrimary}>Click to Upload New Record</span>
                                <span className="text-xs mt-1 z-10" style={textMuted}>PDF, JPG, PNG (Max 5MB) — stored locally on device</span>
                                <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleFileSelect} />
                            </label>
                        ) : (
                            <div className="space-y-4 animate-fadeIn">
                                {/* Selected file card */}
                                <div className="flex items-center justify-between p-4 rounded-xl"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-xl bg-teal-500/10 border border-teal-500/20">
                                            {selectedFile.type === 'application/pdf'
                                                ? <FileText className="h-6 w-6 text-teal-400" />
                                                : <ImageIcon className="h-6 w-6 text-teal-400" />}
                                        </div>
                                        {previewUrl && (
                                            <img src={previewUrl} alt="preview"
                                                className="w-16 h-16 object-cover rounded-lg"
                                                style={{ border: '1px solid var(--border-color)' }} />
                                        )}
                                        <div>
                                            <p className="text-sm font-bold truncate max-w-[200px]" style={textPrimary}>{selectedFile.name}</p>
                                            <p className="text-xs mt-0.5" style={textMuted}>{(selectedFile.size / 1024).toFixed(0)} KB • Ready to upload</p>
                                        </div>
                                    </div>
                                    <button onClick={() => { setSelectedFile(null); setPreviewUrl('') }}
                                        className="px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                                        Remove
                                    </button>
                                </div>

                                {/* Metadata inputs */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {[
                                        {
                                            label: 'Category', type: 'select', value: metadata.category,
                                            onChange: (v: string) => setMetadata({ ...metadata, category: v }),
                                            options: ['Prescription', 'Lab Report', 'X-Ray / Scan', 'Discharge Summary', 'Insurance', 'Other']
                                        },
                                        {
                                            label: 'Date', type: 'date', value: metadata.recordDate,
                                            onChange: (v: string) => setMetadata({ ...metadata, recordDate: v })
                                        },
                                    ].map(field => (
                                        <div key={field.label}>
                                            <label className="text-xs font-bold uppercase tracking-wider mb-1.5 block" style={textMuted}>{field.label}</label>
                                            {field.type === 'select' ? (
                                                <select
                                                    className="w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all font-medium focus:ring-2 focus:ring-teal-500/50"
                                                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                                                    value={field.value}
                                                    onChange={e => field.onChange(e.target.value)}
                                                >
                                                    {field.options!.map(o => <option key={o} value={o}>{o}</option>)}
                                                </select>
                                            ) : (
                                                <input type={field.type}
                                                    className="w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all font-medium focus:ring-2 focus:ring-teal-500/50"
                                                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                                                    value={field.value}
                                                    onChange={e => field.onChange(e.target.value)}
                                                />
                                            )}
                                        </div>
                                    ))}
                                    <div className="md:col-span-2">
                                        <label className="text-xs font-bold uppercase tracking-wider mb-1.5 block" style={textMuted}>Doctor / Hospital Name</label>
                                        <input type="text" placeholder="e.g. Dr. Rajesh, Apollo Hospital"
                                            className="w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all font-medium focus:ring-2 focus:ring-teal-500/50 placeholder:opacity-40"
                                            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                                            value={metadata.doctorName}
                                            onChange={e => setMetadata({ ...metadata, doctorName: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <button onClick={handleUpload} disabled={uploading}
                                    className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    style={{ background: 'linear-gradient(135deg,#14b8a6,#10b981)', color: '#fff', boxShadow: '0 4px 20px rgba(20,184,166,0.25)' }}>
                                    {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                                    {uploading ? 'Uploading...' : 'Confirm Upload'}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Records List */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2" style={textMuted}>
                                <span className="w-2 h-2 rounded-full bg-teal-500 inline-block" />
                                Stored Documents ({records.length})
                            </h3>
                            {loading && <Loader2 className="h-4 w-4 text-teal-400 animate-spin" />}
                        </div>

                        {!loading && records.length === 0 ? (
                            <div className="text-center py-12 rounded-2xl border-2 border-dashed"
                                style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
                                <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                                    style={{ background: 'var(--bg-card)' }}>
                                    <FileText className="h-8 w-8 text-slate-500" />
                                </div>
                                <h4 className="font-bold" style={textPrimary}>No records found</h4>
                                <p className="text-sm mt-1" style={textMuted}>Uploaded documents will appear here</p>
                            </div>
                        ) : (
                            records.map((record: any) => {
                                let meta: any = {}
                                try { meta = JSON.parse(record.content || '{}') } catch { /* ok */ }
                                const isPdf = record.type === 'pdf'
                                const hasFile = !!record.image_b64

                                return (
                                    <div key={record.id}
                                        className="flex items-center justify-between p-4 rounded-xl transition-all group"
                                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
                                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(20,184,166,0.4)')}
                                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}>

                                        <div className="flex items-center gap-3">
                                            {/* Icon */}
                                            <div className={`p-3 rounded-xl ${isPdf ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                                {isPdf ? <FileText className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                                            </div>
                                            {/* Image thumbnail */}
                                            {!isPdf && hasFile && (
                                                <img src={record.image_b64} alt="thumb"
                                                    className="w-11 h-11 object-cover rounded-lg"
                                                    style={{ border: '1px solid var(--border-color)' }} />
                                            )}
                                            <div>
                                                <p className="font-semibold text-sm" style={textPrimary}>
                                                    {meta.category || record.title || 'Document'}
                                                </p>
                                                <div className="flex items-center gap-2 text-xs mt-0.5" style={textMuted}>
                                                    {meta.doctor && (
                                                        <>
                                                            <span className="font-medium text-teal-400">{meta.doctor}</span>
                                                            <span>·</span>
                                                        </>
                                                    )}
                                                    <span>{meta.date || new Date(record.created_at * 1000).toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {hasFile ? (
                                                <button onClick={() => handleView(record)}
                                                    className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all hover:scale-105 active:scale-95"
                                                    style={{ background: 'rgba(20,184,166,0.15)', color: '#2dd4bf', border: '1px solid rgba(20,184,166,0.3)' }}>
                                                    <Eye className="h-3.5 w-3.5" /> View
                                                </button>
                                            ) : (
                                                <span className="text-xs italic" style={textMuted}>No file</span>
                                            )}
                                            <button onClick={() => handleDelete(record.id)}
                                                className="p-2 rounded-lg transition-colors hover:bg-red-500/10 text-red-400/60 hover:text-red-400"
                                                title="Delete">
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>

                {/* ── Footer ── */}
                <div className="p-4 rounded-b-2xl" style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
                    <button onClick={onClose}
                        className="w-full py-3 font-bold rounded-xl transition-all hover:opacity-80"
                        style={{ border: '1px solid var(--border-color)', color: 'var(--text-muted)', background: 'var(--bg-card)' }}>
                        Close
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )
}
