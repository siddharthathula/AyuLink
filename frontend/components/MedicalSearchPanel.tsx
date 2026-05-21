'use client'
import { useState } from 'react'
import { Search, Pill, Activity, Stethoscope, Loader2, AlertTriangle, ChevronDown, ChevronUp, X, Sparkles, BookOpen, Shield, Clock, Info } from 'lucide-react'

const POPULAR = [
  { label: 'Metformin', type: 'medicine' }, { label: 'Paracetamol', type: 'medicine' },
  { label: 'Amlodipine', type: 'medicine' }, { label: 'Diabetes', type: 'disease' },
  { label: 'Hypertension', type: 'disease' }, { label: 'Chest pain', type: 'symptom' },
  { label: 'Dengue', type: 'disease' }, { label: 'Aspirin', type: 'medicine' },
]

const TYPE_CONFIG: Record<string, { icon: any; color: string; bg: string; border: string; label: string }> = {
  medicine: { icon: Pill, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', label: 'Medicine' },
  disease:  { icon: Activity, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Disease' },
  symptom:  { icon: Stethoscope, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'Symptom' },
  general:  { icon: BookOpen, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30', label: 'Info' },
}

function Section({ title, icon: Icon, items, color }: { title: string; icon: any; items: string[]; color: string }) {
  const [open, setOpen] = useState(true)
  if (!items?.length) return null
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-color)' }}>
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3 transition-colors hover:opacity-80"
        style={{ background: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${color}`} />
          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{title}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${color}`} style={{ background: 'var(--bg-card)' }}>{items.length}</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4" style={{ color: 'var(--text-muted)' }} /> : <ChevronDown className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />}
      </button>
      {open && (
        <div className="px-4 py-3 flex flex-wrap gap-2" style={{ background: 'var(--bg-card)' }}>
          {items.map((item: string, i: number) => (
            <span key={i} className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>{item}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function MedicineResult({ r }: { r: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Generic Name', value: r.generic_name, icon: Pill },
          { label: 'Drug Class', value: r.drug_class, icon: BookOpen },
          { label: 'Storage', value: r.storage, icon: Shield },
          { label: 'India Available', value: r.available_in_india ? '✅ Yes' : '❌ No', icon: Info },
        ].map(({ label, value, icon: Icon }) => value ? (
          <div key={label} className="p-3 rounded-xl text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <Icon className="h-4 w-4 mx-auto mb-1 text-blue-400" />
            <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
            <p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
          </div>
        ) : null)}
      </div>
      {r.brand_names?.length > 0 && (
        <div className="p-3 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
          <p className="text-xs font-bold uppercase tracking-wider mb-2 text-blue-400">Brand Names</p>
          <div className="flex flex-wrap gap-2">
            {r.brand_names.map((b: string, i: number) => <span key={i} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-500/10 text-blue-300 border border-blue-500/20">{b}</span>)}
          </div>
        </div>
      )}
      {r.uses?.length > 0 && <Section title="Medical Uses" icon={Stethoscope} items={r.uses} color="text-emerald-400" />}
      {r.dosage && (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-color)' }}>
          <div className="px-4 py-3 flex items-center gap-2" style={{ background: 'var(--bg-secondary)' }}>
            <Clock className="h-4 w-4 text-teal-400" />
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Dosage Guide</span>
          </div>
          <div className="grid grid-cols-3 divide-x" style={{ background: 'var(--bg-card)', borderTop: '1px solid var(--border-color)' }}>
            {[['Adult', r.dosage.adult], ['Elderly', r.dosage.elderly], ['Child', r.dosage.child]].map(([grp, dose]) => dose ? (
              <div key={grp} className="p-3 text-center" style={{ borderColor: 'var(--border-color)' }}>
                <p className="text-xs font-bold text-teal-400">{grp}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-primary)' }}>{dose}</p>
              </div>
            ) : null)}
          </div>
        </div>
      )}
      {r.side_effects?.common?.length > 0 && <Section title="Common Side Effects" icon={AlertTriangle} items={r.side_effects.common} color="text-amber-400" />}
      {r.side_effects?.serious?.length > 0 && <Section title="Serious Side Effects" icon={Shield} items={r.side_effects.serious} color="text-red-400" />}
      {r.contraindications?.length > 0 && <Section title="Contraindications" icon={X} items={r.contraindications} color="text-red-400" />}
      {r.interactions?.length > 0 && <Section title="Drug Interactions" icon={Activity} items={r.interactions} color="text-orange-400" />}
      {r.related_drugs?.length > 0 && <Section title="Related Drugs" icon={Pill} items={r.related_drugs} color="text-blue-400" />}
      {r.when_to_seek_help && (
        <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-400 mb-1">When to Seek Help</p>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{r.when_to_seek_help}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function DiseaseResult({ r }: { r: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: 'Category', value: r.category },
          { label: 'ICD Code', value: r.icd_code },
          { label: 'India Prevalence', value: r.prevalence_india },
        ].map(({ label, value }) => value ? (
          <div key={label} className="p-3 rounded-xl text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
            <p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
          </div>
        ) : null)}
      </div>
      {r.symptoms?.length > 0 && <Section title="Symptoms" icon={Activity} items={r.symptoms} color="text-red-400" />}
      {r.causes?.length > 0 && <Section title="Causes" icon={BookOpen} items={r.causes} color="text-amber-400" />}
      {r.risk_factors?.length > 0 && <Section title="Risk Factors" icon={AlertTriangle} items={r.risk_factors} color="text-orange-400" />}
      {r.diagnosis?.length > 0 && <Section title="Diagnosis" icon={Stethoscope} items={r.diagnosis} color="text-blue-400" />}
      {r.treatment && (
        <div className="space-y-2">
          {r.treatment.medications?.length > 0 && <Section title="Medications" icon={Pill} items={r.treatment.medications} color="text-blue-400" />}
          {r.treatment.lifestyle?.length > 0 && <Section title="Lifestyle Changes" icon={Activity} items={r.treatment.lifestyle} color="text-emerald-400" />}
          {r.treatment.procedures?.length > 0 && <Section title="Procedures" icon={Stethoscope} items={r.treatment.procedures} color="text-purple-400" />}
        </div>
      )}
      {r.prevention?.length > 0 && <Section title="Prevention" icon={Shield} items={r.prevention} color="text-emerald-400" />}
      {r.prognosis && (
        <div className="p-4 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
          <p className="text-xs font-bold uppercase tracking-wider mb-1 text-purple-400">Prognosis</p>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{r.prognosis}</p>
        </div>
      )}
      {r.when_to_seek_help && (
        <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-400 mb-1">When to Seek Help</p>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{r.when_to_seek_help}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function SymptomResult({ r }: { r: any }) {
  return (
    <div className="space-y-4">
      {r.possible_causes?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Possible Causes</p>
          {r.possible_causes.map((c: any, i: number) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{c.condition}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.probability}</p>
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded-lg ${c.severity === 'High' || c.severity === 'Severe' ? 'bg-red-500/10 text-red-400 border border-red-500/30' : c.severity === 'Moderate' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'}`}>{c.severity}</span>
            </div>
          ))}
        </div>
      )}
      {r.red_flags?.length > 0 && (
        <div className="p-4 rounded-xl border border-red-500/40 bg-red-500/10">
          <p className="text-sm font-bold text-red-400 mb-2 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Red Flags — Seek Emergency Care</p>
          <div className="space-y-1">
            {r.red_flags.map((f: string, i: number) => <p key={i} className="text-sm text-red-300 flex items-start gap-2"><span>⚠</span>{f}</p>)}
          </div>
        </div>
      )}
      {r.self_care?.length > 0 && <Section title="Self Care" icon={Shield} items={r.self_care} color="text-emerald-400" />}
      {r.tests_commonly_ordered?.length > 0 && <Section title="Common Tests Ordered" icon={Stethoscope} items={r.tests_commonly_ordered} color="text-blue-400" />}
      {r.related_symptoms?.length > 0 && <Section title="Related Symptoms" icon={Activity} items={r.related_symptoms} color="text-amber-400" />}
      {r.when_to_see_doctor && (
        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10">
          <p className="text-sm font-bold text-amber-400 mb-1">When to See a Doctor</p>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{r.when_to_see_doctor}</p>
        </div>
      )}
    </div>
  )
}

export default function MedicalSearchPanel() {
  const [query, setQuery] = useState('')
  const [searchType, setSearchType] = useState<'auto' | 'medicine' | 'disease' | 'symptom'>('auto')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [language, setLanguage] = useState<'en' | 'hi' | 'te'>('en')

  const doSearch = async (q = query, t = searchType) => {
    if (!q.trim()) return
    setLoading(true); setResult(null); setError('')
    try {
      const host = window.location.hostname
      const res = await fetch(`http://${host}:8000/api/agent/medical-search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, type: t, language })
      })
      const data = await res.json()
      if (data.ok) setResult(data.result)
      else setError(data.error || 'Search failed')
    } catch { setError('Backend not reachable. Make sure the server is running.') }
    finally { setLoading(false) }
  }

  const cfg = result ? TYPE_CONFIG[result.type] || TYPE_CONFIG.general : null
  const ResultIcon = cfg?.icon

  return (
    <div className="space-y-6">
      {/* Search Bar */}
      <div className="rounded-2xl p-6 space-y-4" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(168,85,247,0.06) 100%)', border: '1px solid var(--border-color)' }}>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20">
            <Sparkles className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>Medical Knowledge Search</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Search medicines, diseases, symptoms — powered by AI</p>
          </div>
          <div className="ml-auto flex gap-1 p-1 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            {([['en','🇬🇧'],['hi','🇮🇳 हिं'],['te','🇮🇳 తె']] as const).map(([code, label]) => (
              <button key={code} onClick={() => setLanguage(code as any)}
                className="px-2 py-1 rounded-lg text-[11px] font-bold transition-all"
                style={language === code ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-muted)' }}>{label}</button>
            ))}
          </div>
        </div>

        {/* Type Selector */}
        <div className="flex gap-2 flex-wrap">
          {([['auto','🔍 Auto'], ['medicine','💊 Medicine'], ['disease','🦠 Disease'], ['symptom','🩺 Symptom']] as const).map(([t, label]) => (
            <button key={t} onClick={() => setSearchType(t)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
              style={searchType === t
                ? { background: 'var(--accent)', color: '#fff', boxShadow: '0 2px 12px rgba(99,102,241,0.3)' }
                : { background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5" style={{ color: 'var(--text-muted)' }} />
            <input value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch()}
              placeholder="Search medicine, disease, or symptom..."
              className="w-full pl-12 pr-4 py-3.5 rounded-xl text-sm font-medium outline-none transition-all"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
          </div>
          <button onClick={() => doSearch()} disabled={loading || !query.trim()}
            className="px-6 py-3.5 rounded-xl font-bold text-sm text-white transition-all hover:scale-105 active:scale-95 disabled:opacity-50 flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg,#6366f1,#a855f7)', boxShadow: '0 4px 20px rgba(99,102,241,0.3)' }}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Popular Searches */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Popular Searches</p>
          <div className="flex flex-wrap gap-2">
            {POPULAR.map(p => {
              const tc = TYPE_CONFIG[p.type]
              return (
                <button key={p.label} onClick={() => { setQuery(p.label); setSearchType(p.type as any); doSearch(p.label, p.type as any) }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-105 ${tc.bg} ${tc.color} border ${tc.border}`}>
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Result */}
      {result && cfg && ResultIcon && (
        <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid var(--border-color)` }}>
          {/* Result Header */}
          <div className="p-5" style={{ background: `linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-card) 100%)`, borderBottom: '1px solid var(--border-color)' }}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-2xl ${cfg.bg} border ${cfg.border}`}>
                  <ResultIcon className={`h-7 w-7 ${cfg.color}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color} border ${cfg.border}`}>{cfg.label}</span>
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>AI-powered result</span>
                  </div>
                  <h2 className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
                    {result.name || result.symptom || result.topic || result.query}
                  </h2>
                </div>
              </div>
              <button onClick={() => setResult(null)} className="p-2 rounded-xl hover:bg-red-500/10 transition-colors">
                <X className="h-5 w-5 text-red-400" />
              </button>
            </div>
            {result.overview && (
              <p className="text-sm leading-relaxed mt-4 p-4 rounded-xl" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                {result.overview}
              </p>
            )}
          </div>

          {/* Result Body */}
          <div className="p-5" style={{ background: 'var(--bg-card)' }}>
            {result.type === 'medicine' && <MedicineResult r={result} />}
            {result.type === 'disease' && <DiseaseResult r={result} />}
            {result.type === 'symptom' && <SymptomResult r={result} />}
            {(result.type === 'general' || !result.type) && (
              <div className="space-y-3">
                {result.key_points?.map((kp: string, i: number) => (
                  <div key={i} className="flex gap-3 p-3 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                    <span className="text-purple-400 font-bold">{i + 1}.</span>
                    <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{kp}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer disclaimer */}
          <div className="px-5 py-3 flex items-center gap-2" style={{ background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-color)' }}>
            <Info className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>For educational purposes only. Always consult a qualified healthcare professional before taking any medicine.</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="text-center py-16 rounded-2xl border-2 border-dashed" style={{ borderColor: 'var(--border-color)' }}>
          <div className="inline-flex p-5 rounded-full mb-4" style={{ background: 'var(--bg-secondary)' }}>
            <Search className="h-10 w-10" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
          </div>
          <p className="font-bold" style={{ color: 'var(--text-primary)' }}>Search any medicine, disease, or symptom</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Get AI-powered structured medical information instantly</p>
        </div>
      )}
    </div>
  )
}
