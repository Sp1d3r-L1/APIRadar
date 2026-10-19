import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import jwt from 'jsonwebtoken';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== request.nextUrl.origin || !request.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: 'Same-origin JSON request required' }, { status: 403 });
  }
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.email || !process.env.NEXTAUTH_SECRET) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  let body: { enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
  }

  const backendToken = jwt.sign(
    { id: token.id || token.sub, email: token.email },
    process.env.NEXTAUTH_SECRET,
    { expiresIn: '5m' }
  );
  const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:3001';
  try {
    const response = await fetch(`${backendUrl.replace('localhost', '127.0.0.1')}/api/verification/review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${backendToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: body.enabled }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000)
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ error: 'Verification review unavailable' }, { status: 503 });
  }
}
