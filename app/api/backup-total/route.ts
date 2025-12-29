
import { NextRequest, NextResponse } from 'next/server';
import archiver from 'archiver';
import ExcelJS from 'exceljs';
import { PassThrough } from 'stream';
import { fetchODataPages } from '@/lib/spotter-stream';
import { safeCsvField } from '@/lib/csv/secure-writer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes (Vercel Limit usually)

// --- Configurations ---

interface EntityConfig {
  key: string;
  endpoint: string;
  category: string;
  filename: string;
}

const ENTITIES: EntityConfig[] = [
  // Core
  { key: 'leads', endpoint: '/api/v3/Leads', category: 'core', filename: 'leads.csv' },
  { key: 'companies', endpoint: '/api/v3/Organization', category: 'core', filename: 'companies.csv' },
  { key: 'contacts', endpoint: '/api/v3/Persons', category: 'core', filename: 'contacts.csv' },
  { key: 'users', endpoint: '/api/v3/Users', category: 'core', filename: 'users.csv' },
  { key: 'sellers', endpoint: '/api/v3/Sellers', category: 'core', filename: 'sellers.csv' },
  { key: 'groups', endpoint: '/api/v3/Groups', category: 'core', filename: 'groups.csv' },

  // Events
  { key: 'losts', endpoint: '/api/v3/Losts', category: 'events', filename: 'lead_losts.csv' },
  { key: 'history', endpoint: '/api/v3/transferHistory', category: 'events', filename: 'lead_transfers.csv' },
  { key: 'meetings', endpoint: '/api/v3/Meetings', category: 'events', filename: 'meetings.csv' },

  // Dictionaries
  { key: 'funnels', endpoint: '/api/v3/funnels', category: 'dictionaries', filename: 'funnels.csv' },
  { key: 'stages', endpoint: '/api/v3/stages', category: 'dictionaries', filename: 'stages.csv' },
  { key: 'sources', endpoint: '/api/v3/Sources', category: 'dictionaries', filename: 'sources.csv' },
  { key: 'discard_reasons', endpoint: '/api/v3/DiscardReason', category: 'dictionaries', filename: 'discard_reasons.csv' },
  { key: 'products', endpoint: '/api/v3/products', category: 'dictionaries', filename: 'products.csv' },
  { key: 'tasks_type', endpoint: '/api/v3/TasksType', category: 'dictionaries', filename: 'tasks_type.csv' },
  { key: 'custom_fields_leads', endpoint: '/api/v3/CustomFields', category: 'dictionaries', filename: 'custom_fields_leads.csv' },
  { key: 'custom_fields_orgs', endpoint: '/api/v3/CustomFieldsOrganization', category: 'dictionaries', filename: 'custom_fields_companies.csv' },
];

export async function GET(req: NextRequest) {
  const token = process.env.SPOTTER_TOKEN_EXACT;
  const baseUrl = process.env.SPOTTER_API_URL || 'https://api.exactspotter.com';

  if (!token) {
    return NextResponse.json({ message: 'Missing SPOTTER_TOKEN_EXACT' }, { status: 500 });
  }

  // 1. Prepare Zip Stream
  const passThrough = new PassThrough();
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    console.error('Archiver error:', err);
    // Try to emit error on passThrough to break connection if possible
    passThrough.destroy(err);
  });

  archive.pipe(passThrough);

  // 2. Prepare Logging & Stats
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const extractionLogs: string[] = ['timestamp,entity,page,count,message,status'];
  const entityStats: Record<string, { count: number; status: 'OK' | 'FAIL' | 'SKIP'; endpoint: string }> = {};

  const log = (entity: string, msg: string, status: string = 'INFO') => {
    const timestamp = new Date().toISOString();
    // Simple CSV escaping for log
    const line = [timestamp, entity, '-', '-', `"${msg.replace(/"/g, '""')}"`, status].join(',');
    extractionLogs.push(line);
    console.log(`[Backup][${entity}] ${msg}`);
  };

  // 3. Process Entities (Async but sequential)
  (async () => {
    try {
      // A. Metadata
      archive.append(JSON.stringify({
        runId,
        date: new Date().toISOString(),
        entities: ENTITIES.map(e => e.key)
      }, null, 2), { name: 'metadata/export_info.json' });

      // B. Entities
      for (const config of ENTITIES) {
        log(config.key, `Starting export from ${config.endpoint}...`);
        const fullUrl = `${baseUrl}${config.endpoint}`;

        try {
            const generator = fetchODataPages(fullUrl, token, (msg) => log(config.key, msg));

            const csvStream = new PassThrough();
            archive.append(csvStream, { name: `${config.category}/${config.filename}` });

            let count = 0;
            let headers: string[] | null = null;

            for await (const page of generator) {
                if (!page.items || page.items.length === 0) continue;
                const items = page.items as Record<string, unknown>[];

                // Initialize headers from the very first batch
                if (!headers) {
                     headers = Object.keys(items[0]);
                     csvStream.write('\ufeff');
                     csvStream.write(headers.map(h => safeCsvField(h)).join(',') + '\n');
                }

                // Use the FIXED headers for all items
                for (const item of items) {
                    const row = headers.map(k => safeCsvField(item[k]));
                    csvStream.write(row.join(',') + '\n');
                    count++;
                }
            }

            // Important: End the stream for this file so archiver knows it's done
            csvStream.end();

            entityStats[config.key] = { count, status: 'OK', endpoint: config.endpoint };
            log(config.key, `Finished. ${count} items.`);

        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log(config.key, `FAILED: ${msg}`, 'ERROR');
            entityStats[config.key] = { count: 0, status: 'FAIL', endpoint: config.endpoint };
            archive.append(`Error exporting ${config.key}: ${msg}`, { name: `${config.category}/${config.key}_ERROR.txt` });
        }
      }

      // C. Generate Index XLSX
      const workbook = new ExcelJS.Workbook();
      const wsEnt = workbook.addWorksheet('Entidades');
      wsEnt.columns = [
          { header: 'Entidade', key: 'key', width: 20 },
          { header: 'Endpoint', key: 'endpoint', width: 40 },
          { header: 'Arquivo', key: 'file', width: 30 },
          { header: 'Contagem', key: 'count', width: 15 },
          { header: 'Status', key: 'status', width: 10 },
      ];

      ENTITIES.forEach(e => {
          const s = entityStats[e.key] || { count: 0, status: 'SKIP', endpoint: e.endpoint };
          wsEnt.addRow({
              key: e.key,
              endpoint: s.endpoint,
              file: `${e.category}/${e.filename}`,
              count: s.count,
              status: s.status
          });
      });

      const wsLog = workbook.addWorksheet('Logs');
      wsLog.columns = [{ header: 'Log Line', key: 'line', width: 100 }];
      extractionLogs.forEach(l => wsLog.addRow({ line: l }));

      const buffer = await workbook.xlsx.writeBuffer();
      archive.append(Buffer.from(buffer), { name: 'index.xlsx' });

      // D. Append Logs CSV
      archive.append(extractionLogs.join('\n'), { name: 'metadata/extraction_log.csv' });

    } catch (err) {
      console.error('Backup Fatal Error', err);
      // Try to append error log if archive is still open
      try {
          archive.append(JSON.stringify(err), { name: 'FATAL_ERROR.json' });
      } catch (e) { /* ignore */ }
    } finally {
      // ALWAYS finalize
      archive.finalize();
    }
  })();

  return new NextResponse(passThrough as any, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="spotter-backup-${runId}.zip"`,
    },
  });
}
