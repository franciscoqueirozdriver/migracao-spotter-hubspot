// app/api/export-deals-line-items/route.ts
import { exportDealsAndLineItemsToCsv } from '../../../lib/deals';

export const dynamic = 'force-dynamic';

export async function GET() {
  const token = process.env.SPOTTER_TOKEN_EXACT;
  const baseUrl = process.env.SPOTTER_BASE_URL || 'https://api.exactspotter.com';

  if (!token) {
    return new Response(JSON.stringify({ error: 'SPOTTER_TOKEN_EXACT environment variable is not set.' }), {
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
        const { csvContent } = await exportDealsAndLineItemsToCsv(token, baseUrl, log);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', csvContent })}\n\n`));
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
