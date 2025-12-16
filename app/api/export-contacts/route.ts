// app/api/export-contacts/route.ts
import { exportContactsToCsv, CONTACT_HEADERS } from '../../../lib/contacts';
import { buildCsv, sanitizeCsvValue } from '../../../lib/csv';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  const token = process.env.SPOTTER_TOKEN_EXACT;

  if (!token) {
    return new Response(JSON.stringify({ type: 'error', message: 'SPOTTER_TOKEN_EXACT not configured.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      const log = (message: string) => {
        console.log(message);
        send({ type: 'log', message });
      };

      try {
        const { validRows, rejectedRows, logData } = await exportContactsToCsv(token, log);

        // 1. Generate unique ID for this export
        const exportId = `export-${Date.now()}`;

        // 2. Build CSV for valid contacts
        const validCsvRows = validRows.map(row => CONTACT_HEADERS.map(header => sanitizeCsvValue(row[header])));
        const csvContent = buildCsv(CONTACT_HEADERS, validCsvRows);
        log('CSV de contatos válidos gerado.');

        // 3. Cache rejected contacts data temporarily
        if (rejectedRows.length > 0) {
          const exportsDir = path.join('/tmp', 'exports');
          fs.mkdirSync(exportsDir, { recursive: true });
          const rejectedJsonPath = path.join(exportsDir, `rejected-${exportId}.json`);
          fs.writeFileSync(rejectedJsonPath, JSON.stringify(rejectedRows));
          log(`Dados de contatos rejeitados salvos temporariamente. ID: ${exportId}`);
        }

        // 4. Send 'done' signal with CSV content and exportId
        send({
          type: 'done',
          csvContent: csvContent,
          exportId: rejectedRows.length > 0 ? exportId : null,
          logData: logData,
        });

      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown server error.';
        log(`FATAL ERROR: ${message}`);
        send({ type: 'error', message });
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
