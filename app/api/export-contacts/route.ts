// app/api/export-contacts/route.ts
import { exportContactsToCsv } from '../../../lib/contacts';

export const dynamic = 'force-dynamic'; // Garante que a rota não seja estática

export async function GET() {
  const token = process.env.SPOTTER_TOKEN_EXACT;

  if (!token) {
    return new Response(JSON.stringify({ type: 'error', message: 'Variável de ambiente SPOTTER_TOKEN_EXACT não configurada.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const sendData = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const log = (message: string) => {
        console.log(message); // Log no servidor
        sendData({ type: 'log', message });
      };

      try {
        const { csvContent, logData } = await exportContactsToCsv(token, log);

        sendData({
          type: 'done',
          csvContent: csvContent,
          logFileName: 'spotter_to_hubspot_contatos.log.json',
          logContent: JSON.stringify(logData, null, 2),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Um erro desconhecido ocorreu no servidor.';
        log(`ERRO FATAL: ${errorMessage}`);
        sendData({ type: 'error', message: errorMessage });
      } finally {
        controller.close();
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
