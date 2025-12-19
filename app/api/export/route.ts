// app/api/export/route.ts
import { NextRequest } from 'next/server';
import { exportDataForMode, ExportMode, ExportableEntity } from '@/lib/exporter';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = (searchParams.get('mode') ?? 'sold') as ExportMode;
  const entity = searchParams.get('export') as ExportableEntity | null;

  if (!entity) {
    // This case should ideally be handled by the stream as well, but for simplicity...
    return new Response(JSON.stringify({ message: 'Nenhuma entidade para exportação foi fornecida.' }), { status: 400 });
  }

  const token = process.env.SPOTTER_TOKEN_EXACT;
  const baseUrl = process.env.SPOTTER_API_URL || 'https://api.exactspotter.com';

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const sendLog = (message: string) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', message })}\n\n`));
      const sendError = (message: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message })}\n\n`));
        controller.close();
      };

      // --- Moved Validation Inside Stream ---
      const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
      if (isProduction && !process.env.BLOB_READ_WRITE_TOKEN) {
        sendError('Erro de configuração do servidor: A variável de ambiente BLOB_READ_WRITE_TOKEN não está definida.');
        return;
      }
      if (!token) {
        sendError('Erro de configuração do servidor: O token de autenticação do Spotter não está configurado.');
        return;
      }
      // --- End of Moved Validation ---

      try {
        sendLog(`Iniciando exportação no modo: ${mode} para a entidade: ${entity}`);
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
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}
