
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const token = process.env.SPOTTER_TOKEN_EXACT || 'NOT_SET';
  const baseUrl = process.env.SPOTTER_API_URL || 'https://api.exactspotter.com';

  // Safe endpoint to test
  const testPath = '/api/v3/stages';

  const normalizedBase = baseUrl.replace(/\/$/, '');
  const normalizedPath = testPath.replace(/^\//, '');
  const finalUrl = `${normalizedBase}/${normalizedPath}`;

  let fetchResult = {};

  try {
      const res = await fetch(finalUrl, {
          headers: {
              'token_exact': token,
              'Content-Type': 'application/json'
          }
      });

      const text = await res.text();
      const snippet = text.slice(0, 500);

      fetchResult = {
          status: res.status,
          statusText: res.statusText,
          ok: res.ok,
          finalUrl,
          headers: Object.fromEntries(res.headers.entries()),
          bodySnippet: snippet
      };

  } catch (e) {
      fetchResult = {
          error: e instanceof Error ? e.message : String(e),
          finalUrl
      };
  }

  return NextResponse.json({
    config: {
        baseUrl,
        tokenSet: token !== 'NOT_SET',
        tokenLength: token.length,
        nodeVersion: process.version,
    },
    testFetch: fetchResult
  });
}
