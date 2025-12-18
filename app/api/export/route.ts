// app/api/export/route.ts
import { NextRequest } from 'next/server';
import { exportDataForMode, ExportMode, ExportableEntity } from '@/lib/exporter';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') as ExportMode;
  const exportEntitiesParam = searchParams.get('export');

  if (!mode || !['sold', 'open', 'lost', 'custom'].includes(mode)) {
    return new Response(JSON.stringify({ message: 'Modo inválido ou não fornecido.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!exportEntitiesParam || exportEntitiesParam.length === 0) {
    return new Response(JSON.stringify({ message: 'Nenhuma entidade para exportação foi fornecida.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const entitiesToExport = exportEntitiesParam.split(',') as ExportableEntity[];
  const validEntities: ExportableEntity[] = ['companies', 'contacts', 'deals_line_items'];
  for (const entity of entitiesToExport) {
    if (!validEntities.includes(entity)) {
        return new Response(JSON.stringify({ message: `Entidade de exportação inválida: ${entity}` }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }
  }

  const token = process.env.SPOTTER_TOKEN_EXACT;
  const baseUrl = process.env.SPOTTER_API_URL || 'https://api.exactspotter.com';

  if (!token) {
    return new Response(JSON.stringify({ message: 'Token de autenticação do Spotter não configurado.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendLog = (message: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', message })}\n\n`));
      };

      const sendError = (message: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message })}\n\n`));
        controller.close();
      };

      try {
        sendLog(`Iniciando exportação no modo: ${mode} para entidades: ${entitiesToExport.join(', ')}`);
        const { exportId } = await exportDataForMode(mode, entitiesToExport, token, baseUrl, sendLog);

        const doneMessage = {
          type: 'done',
          exportId: exportId, // The frontend will use this to build a download link
        };
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
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
