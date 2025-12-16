// app/api/export-contacts/route.ts
import { exportContactsToCsv } from '../../../lib/contacts';
import fs from 'fs';
import path from 'path';

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
        const { csvContent, rejectedCsvContent, logData } = await exportContactsToCsv(token, log);

        // Salvar o CSV de contatos rejeitados no servidor
        try {
          const exportsDir = path.join(process.cwd(), 'exports');
          fs.mkdirSync(exportsDir, { recursive: true });
          const rejectedCsvPath = path.join(exportsDir, 'spotter_to_hubspot_contatos__rejeitados_normalizar.csv');
          fs.writeFileSync(rejectedCsvPath, rejectedCsvContent);
          log(`Arquivo de contatos rejeitados salvo em: ${rejectedCsvPath}`);
          log(`Total de contatos buscados: ${logData.stats.receivedPersons}`);
          log(`Total exportado com sucesso: ${logData.stats.validContacts}`);
          log(`Total rejeitado para normalização: ${rejectedCsvContent.length > 0 ? logData.stats.skippedNoEmail + logData.stats.skippedDuplicates : 0}`);
          log(`- Rejeitados por falta de e-mail: ${logData.stats.skippedNoEmail}`);
          log(`- Rejeitados por e-mail duplicado: ${logData.stats.skippedDuplicates}`);

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
          log(`ERRO ao salvar o CSV de contatos rejeitados: ${errorMessage}`);
          // Não para a execução, apenas loga o erro.
        }

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
