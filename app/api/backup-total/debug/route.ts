
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const token = process.env.SPOTTER_TOKEN_EXACT;
  const baseUrl = process.env.SPOTTER_API_URL || 'https://api.exactspotter.com/v3/';

  // Safe construction for test
  const safeBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const testEndpoint = 'stages';
  const finalUrl = new URL(testEndpoint, safeBase).toString();

  let upstreamResult = null;
  let status = 200;

  if (token) {
    try {
      const res = await fetch(`${finalUrl}?$top=1`, {
        headers: { 'token_exact': token }
      });
      status = res.status;
      const text = await res.text();
      try {
        upstreamResult = JSON.parse(text);
      } catch {
        upstreamResult = text.slice(0, 500); // Return raw text if not JSON
      }
    } catch (err) {
      status = 502;
      upstreamResult = { error: String(err) };
    }
  } else {
    upstreamResult = { error: 'No token provided' };
  }

  return NextResponse.json({
    config: {
      baseUrl,
      safeBase,
      testEndpoint,
      finalUrl,
      hasToken: !!token,
      tokenMasked: token ? `${token.slice(0, 4)}...${token.slice(-4)}` : null
    },
    upstream: {
      status,
      result: upstreamResult
    }
  }, { status: 200 }); // Always return 200 from debug endpoint itself to view diagnostics
}
