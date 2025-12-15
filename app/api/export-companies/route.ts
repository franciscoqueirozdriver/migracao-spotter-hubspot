// app/api/export-companies/route.ts
import { exportCompaniesToCsv } from '../../../lib/companies';

export const dynamic = 'force-dynamic';

export async function GET() {
  const token = process.env.SPOTTER_TOKEN;

  if (!token) {
    return new Response(JSON.stringify({ error: 'SPOTTER_TOKEN environment variable is not set.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const log = (message: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', message })}\n\n`));
      };

      try {
        const { csvContent, logData } = await exportCompaniesToCsv(token, log);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', csvContent, logData })}\n\n`));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: errorMessage })}\n\n`));
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
