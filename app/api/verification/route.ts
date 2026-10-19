import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import jwt from 'jsonwebtoken';

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.email || !process.env.NEXTAUTH_SECRET) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  const backendToken = jwt.sign(
    { id: token.id || token.sub, email: token.email },
    process.env.NEXTAUTH_SECRET,
    { expiresIn: '5m' }
  );
  const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:3001';
  try {
    const response = await fetch(`${backendUrl.replace('localhost', '127.0.0.1')}/api/verification`, {
      headers: { Authorization: `Bearer ${backendToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000)
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ error: 'Verification service unavailable' }, { status: 503 });
  }
}
