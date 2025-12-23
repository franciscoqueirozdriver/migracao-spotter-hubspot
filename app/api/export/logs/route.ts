
import { NextRequest, NextResponse } from "next/server";
import { getLogs } from "@/lib/export/logStore";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get('runId');

  if (!runId) {
      return NextResponse.json({ message: 'Run ID required' }, { status: 400 });
  }

  const lines = getLogs(runId);

  if (lines.length === 0) {
      // Just return empty if not found or empty, client handles it
      return NextResponse.json({ lines: [], lastUpdatedAt: new Date().toISOString() });
  }

  return NextResponse.json({
    lines: lines,
    lastUpdatedAt: new Date().toISOString(),
  });
}
