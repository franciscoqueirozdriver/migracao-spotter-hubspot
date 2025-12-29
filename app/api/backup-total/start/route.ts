
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { initJob, cleanupOldJobs } from '@/lib/backup/jobStore';
import { runBackup } from '@/lib/backup/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Optional: Check Admin Auth here

  const jobId = uuidv4();

  // Clean up old jobs before starting new one
  cleanupOldJobs();

  // Initialize job directory and status
  initJob(jobId);

  const url = new URL(req.url);
  const mode = url.searchParams.get('mode');

  if (mode === 'sync') {
    // For local dev/debugging or small datasets
    await runBackup(jobId);
  } else {
    // Async execution
    // Note: Vercel serverless might kill this promise if the request ends.
    // However, Node.js runtime usually allows background work to continue for a bit
    // or we can use `waitUntil` (if available in edge, but we are in node).
    // In Node runtime, an unawaited promise continues until the lambda freezes.
    // Ideally, we'd use a queue (Redis/SQS), but per constraints, we use this "fire and forget".
    // We wrap it in setImmediate to ensure it runs on next tick.

    // Warning: On Vercel, this is not guaranteed to finish if request closes.
    // But user asked for this architecture.
    setImmediate(() => {
        runBackup(jobId).catch(err => console.error("Background job failed", err));
    });
  }

  return NextResponse.json({ jobId });
}
