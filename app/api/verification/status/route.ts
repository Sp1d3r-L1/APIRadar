import { NextResponse } from 'next/server';

export async function GET() {
  const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:3001';
  try {
    const response = await fetch(`${backendUrl.replace('localhost', '127.0.0.1')}/api/verification/status`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000)
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ error: 'Verification status unavailable' }, { status: 503 });
  }
}
