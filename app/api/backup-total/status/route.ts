
import { NextRequest, NextResponse } from 'next/server';
import { getStatus } from '@/lib/backup/jobStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ message: 'Missing jobId' }, { status: 400 });
  }

  const status = getStatus(jobId);
  if (!status) {
    return NextResponse.json({ message: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json(status);
}
