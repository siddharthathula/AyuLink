import { NextRequest, NextResponse } from 'next/server'

// Persisted upstream URL (module-level – survives across requests in same process)
let upstreamUrl = 'http://10.73.201.20:81/stream'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'  // needs Node.js for streaming

export async function GET() {
  try {
    // Dynamically sync with backend camera config
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'
      const camConfigRes = await fetch(`${backendUrl}/api/camera`, { next: { revalidate: 2 } })
      if (camConfigRes.ok) {
        const data = await camConfigRes.json()
        if (data.url) {
          upstreamUrl = data.url
        }
      }
    } catch (e) {
      console.warn('[cam-proxy] failed to sync with backend config, using cache:', upstreamUrl)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const upstream = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: {
        'Connection': 'keep-alive',
      },
    })
    clearTimeout(timeout)

    if (!upstream.ok || !upstream.body) {
      return new NextResponse('Camera offline or not reachable', { status: 502 })
    }

    const contentType = upstream.headers.get('content-type') ?? 'multipart/x-mixed-replace;boundary=123456789000000000000987654321'

    return new NextResponse(upstream.body as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
        'Transfer-Encoding': 'chunked',
      },
    })
  } catch (err: any) {
    console.error('[cam-proxy] error:', err?.message)
    return new NextResponse(`Camera error: ${err?.message}`, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (body.url) upstreamUrl = body.url
  return NextResponse.json({ ok: true, url: upstreamUrl })
}
