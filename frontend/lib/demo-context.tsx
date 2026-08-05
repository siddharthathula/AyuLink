"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'

interface DemoContextType {
    isDemoMode: boolean
    setDemoMode: (value: boolean) => void
    toggleDemoMode: () => void
}

const DemoContext = createContext<DemoContextType | undefined>(undefined)

export function DemoProvider({ children }: { children: React.ReactNode }) {
    const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('ayulink_simulation_mode')
            return saved === 'true'
        }
        return false
    })

    // On mount: sync with backend simulation API
    useEffect(() => {
        fetch('/api/simulation')
            .then(r => r.json())
            .then(d => {
                if (typeof d.enabled === 'boolean') {
                    setIsDemoMode(d.enabled)
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('ayulink_simulation_mode', String(d.enabled))
                    }
                }
            })
            .catch(() => {})
    }, [])

    const setDemoMode = async (value: boolean) => {
        setIsDemoMode(value)
        if (typeof window !== 'undefined') {
            localStorage.setItem('ayulink_simulation_mode', String(value))
        }
        try {
            await fetch('/api/simulation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: value }),
            })
        } catch { /* best-effort */ }
    }

    const toggleDemoMode = () => {
        setDemoMode(!isDemoMode)
    }

    return (
        <DemoContext.Provider value={{ isDemoMode, setDemoMode, toggleDemoMode }}>
            {children}
        </DemoContext.Provider>
    )
}

export function useDemoMode() {
    const context = useContext(DemoContext)
    if (context === undefined) {
        throw new Error('useDemoMode must be used within a DemoProvider')
    }
    return context
}
