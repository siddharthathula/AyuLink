"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'

interface DemoContextType {
    isDemoMode: boolean
    setDemoMode: (value: boolean) => void
    toggleDemoMode: () => void
}

const DemoContext = createContext<DemoContextType | undefined>(undefined)

export function DemoProvider({ children }: { children: React.ReactNode }) {
    // Initialize from localStorage if available
    const [isDemoMode, setIsDemoMode] = useState(false)
    const [initialized, setInitialized] = useState(false)

    // Persist demo mode preference — restore from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem('ayulink_demo_mode')
            if (saved !== null) {
                setIsDemoMode(JSON.parse(saved))
            }
            // If no saved preference, auto-detect: check if DB has patients
            // If empty, auto-enable demo mode so judges always see data
            if (saved === null || saved === 'false') {
                autoDetectDemoMode()
            }
        } catch {
            setIsDemoMode(false)
        }
        setInitialized(true)
    }, [])

    const autoDetectDemoMode = async () => {
        try {
            const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
            const res = await fetch(`http://${host}:8000/api/patients`, { signal: AbortSignal.timeout(3000) })
            const data = await res.json()
            if (data.ok && (!data.patients || data.patients.length === 0)) {
                // Database empty — auto-enable demo mode
                setIsDemoMode(true)
                localStorage.setItem('ayulink_demo_mode', 'true')
            }
        } catch {
            // Backend not reachable — enable demo mode as fallback
            setIsDemoMode(true)
            localStorage.setItem('ayulink_demo_mode', 'true')
        }
    }

    const setDemoMode = (value: boolean) => {
        setIsDemoMode(value)
        localStorage.setItem('ayulink_demo_mode', JSON.stringify(value))
        // Reload page to ensure clean state reset
        if (typeof window !== 'undefined') {
            setTimeout(() => window.location.reload(), 100)
        }
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
