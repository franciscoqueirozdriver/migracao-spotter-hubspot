// app/api/export/route.ts
import { NextRequest } from 'next/server';
import { exportDataForMode, ExportMode, ExportableEntity } from '@/lib/exporter';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = (searchParams.get('mode') ?? 'sold') as ExportMode;
  const entity = searchParams.get('export') as ExportableEntity | null;

  // Basic validation
  if (!entity) {
    return new Response(JSON.stringify({ message: 'Nenhuma entidade para exportação foi fornecida.' }), { status: 400 });
  }
  const validModes: ExportMode[] = ['sold', 'inProgress', 'lost'];
  if (!validModes.includes(mode)) {
    return new Response(JSON.stringify({ message: 'Modo inválido ou não suportado.' }), { status: 400 });
  }

  const token = process.env.SPOTTER_TOKEN_EXACT;
  const baseUrl = process.env.SPOTTER_API_URL || 'https://api.exactspotter.com';
  if (!token) {
    return new Response(JSON.stringify({ message: 'Token de autenticação do Spotter não configurado.' }), { status: 500 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const sendLog = (message: string) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', message })}\n\n`));
      const sendError = (message: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message })}\n\n`));
        controller.close();
      };

      try {
        const { downloadRef } = await exportDataForMode(mode, entity, token, baseUrl, sendLog);

        const doneMessage = { type: 'done', exportId: downloadRef };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneMessage)}\n\n`));
        controller.close();
      } catch (error) {
        console.error('Falha na exportação:', error);
        const errorMessage = error instanceof Error ? error.message : 'Ocorreu um erro desconhecido no servidor.';
        sendError(errorMessage);
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}
