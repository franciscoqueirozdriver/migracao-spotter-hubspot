// app/api/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { exportDataForMode, ExportMode, ExportableEntity } from '@/lib/exporter';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = (searchParams.get('mode') ?? 'sold') as ExportMode;
  const entity = searchParams.get('export') as ExportableEntity | null;

  const validModes: ExportMode[] = ['sold', 'inProgress', 'lost'];
  if (!validModes.includes(mode)) {
    return new NextResponse(JSON.stringify({ message: 'Modo inválido ou não suportado.' }), { status: 400 });
  }

  if (!entity) {
    return new NextResponse(JSON.stringify({ message: 'Nenhuma entidade para exportação foi fornecida.' }), { status: 400 });
  }

  const token = process.env.SPOTTER_TOKEN_EXACT;
  const baseUrl = process.env.SPOTTER_API_URL || 'https://api.exactspotter.com';

  if (!token) {
    return new NextResponse(JSON.stringify({ message: 'Token de autenticação do Spotter não configurado.' }), { status: 500 });
  }

  try {
    const { fileName, content } = await exportDataForMode(mode, entity, token, baseUrl);

    if (!content) {
        return new NextResponse(JSON.stringify({ message: 'Nenhum dado gerado para a exportação.' }), { status: 200 });
    }

    const headers = new Headers();
    headers.set('Content-Type', 'text/csv; charset=utf-8');
    headers.set('Content-Disposition', `attachment; filename="${fileName}"`);

    return new Response(content, { headers });

  } catch (error) {
    console.error('Falha na exportação:', error);
    const errorMessage = error instanceof Error ? error.message : 'Ocorreu um erro desconhecido no servidor.';
    return new NextResponse(JSON.stringify({ message: errorMessage }), { status: 500 });
  }
}
