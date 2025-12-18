// app/api/export/route.ts
import { NextRequest } from 'next/server';
import { exportDataForMode, ExportMode } from '../../../lib/exporter';

export const dynamic = 'force-dynamic'; // Defaults to auto
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') as ExportMode;

  if (!mode || !['sold', 'open', 'lost', 'custom'].includes(mode)) {
    return new Response(JSON.stringify({ message: 'Modo inválido ou não fornecido.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
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
        sendLog(`Iniciando exportação no modo: ${mode}`);
        const { exportId, csvContent } = await exportDataForMode(mode, token, baseUrl, sendLog);

        const doneMessage = {
          type: 'done',
          exportId,
          csvContent,
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
