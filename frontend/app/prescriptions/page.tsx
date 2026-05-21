'use client'

import { Pill, Activity, ChevronRight } from 'lucide-react'
import { useTheme } from '@/lib/theme-context'
import Link from 'next/link'
import MedicineScheduleManager from '@/components/MedicineScheduleManager'



export default function PrescriptionsPage() {
    const { t } = useTheme()

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-[var(--foreground)] tracking-tight">{t('prescriptions')}</h1>
                    <p className="mt-1 text-[var(--muted-foreground)]">Manage medical protocols and dispensing schedules</p>
                </div>
            </div>

            {/* Unified Management Hub */}
            <div className="glass-card rounded-[2.5rem] overflow-hidden shadow-2xl border border-white/10">
                <MedicineScheduleManager />
            </div>

            {/* Compliance Stats Shortcut (Optional/Decorative) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="glass-card p-8 rounded-3xl flex items-center gap-6 group hover:bg-white/5 transition-all cursor-pointer">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform">
                        <Pill className="h-8 w-8" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-[var(--foreground)]">Dispenser Health</h3>
                        <p className="text-sm text-[var(--muted-foreground)]">Check physical slot status and LoRa connectivity</p>
                    </div>
                    <ChevronRight className="ml-auto h-6 w-6 text-[var(--muted-foreground)]" />
                </div>

                <Link href="/dashboard" className="glass-card p-8 rounded-3xl flex items-center gap-6 group hover:bg-white/5 transition-all cursor-pointer">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform">
                        <Activity className="h-8 w-8" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-[var(--foreground)]">Compliance Analytics</h3>
                        <p className="text-sm text-[var(--muted-foreground)]">View historical adherence data on dashboard</p>
                    </div>
                    <ChevronRight className="ml-auto h-6 w-6 text-[var(--muted-foreground)]" />
                </Link>
            </div>
        </div>
    )
}
