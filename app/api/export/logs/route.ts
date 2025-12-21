
import { NextResponse } from 'next/server';
import { getLastLog } from '@/lib/exporter';

export const dynamic = 'force-dynamic';

export async function GET() {
  const log = getLastLog();

  if (!log) {
    return NextResponse.json({ message: 'Nenhum log de exportação disponível.' }, { status: 404 });
  }

  return NextResponse.json(log);
}
