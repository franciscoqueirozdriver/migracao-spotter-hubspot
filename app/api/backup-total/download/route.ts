
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { validatePath } from '@/lib/backup/jobStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  const filePath = searchParams.get('path');

  if (!jobId || !filePath) {
    return NextResponse.json({ message: 'Missing parameters' }, { status: 400 });
  }

  const fullPath = validatePath(jobId, filePath);
  if (!fullPath || !fs.existsSync(fullPath)) {
    return NextResponse.json({ message: 'File not found or invalid path' }, { status: 404 });
  }

  const stat = fs.statSync(fullPath);
  const stream = fs.createReadStream(fullPath);

  // Determine Content-Type
  let contentType = 'application/octet-stream';
  if (filePath.endsWith('.csv')) contentType = 'text/csv; charset=utf-8';
  else if (filePath.endsWith('.json')) contentType = 'application/json';
  else if (filePath.endsWith('.xlsx')) contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  return new NextResponse(stream as any, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`,
      'Content-Length': stat.size.toString(),
    },
  });
}
