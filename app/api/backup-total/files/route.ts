
import { NextRequest, NextResponse } from 'next/server';
import { listFiles, getStatus } from '@/lib/backup/jobStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ message: 'Missing jobId' }, { status: 400 });
  }

  // Security check: only allow listing if job exists
  const status = getStatus(jobId);
  if (!status) {
    return NextResponse.json({ message: 'Job not found' }, { status: 404 });
  }

  const files = listFiles(jobId);
  return NextResponse.json({ files });
}
