
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { getJobDir, saveStatus, getStatus, JobStatus } from './jobStore';
import { fetchODataPages } from '@/lib/spotter-stream';
import { safeCsvField } from '@/lib/csv/secure-writer';

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

export async function runBackup(jobId: string) {
  const token = process.env.SPOTTER_TOKEN_EXACT;
  const baseUrl = process.env.SPOTTER_API_URL || 'https://api.exactspotter.com';

  const status = getStatus(jobId);
  if (!status) return;

  status.status = 'running';
  saveStatus(jobId, status);

  const jobDir = getJobDir(jobId);
  const extractionLogs: string[] = ['timestamp,entity,page,count,message,status'];
  const entityStats: Record<string, { count: number; status: 'OK' | 'FAIL' | 'SKIP'; endpoint: string }> = {};

  const log = (entity: string, msg: string, code: string = 'INFO') => {
    const timestamp = new Date().toISOString();
    const line = [timestamp, entity, '-', '-', `"${msg.replace(/"/g, '""')}"`, code].join(',');
    extractionLogs.push(line);
    // console.log(`[Backup Job ${jobId}][${entity}] ${msg}`);
  };

  try {
    // Write metadata
    fs.writeFileSync(
      path.join(jobDir, 'metadata', 'export_info.json'),
      JSON.stringify({
        jobId,
        date: new Date().toISOString(),
        entities: ENTITIES.map(e => e.key)
      }, null, 2)
    );

    if (!token) throw new Error("Missing SPOTTER_TOKEN_EXACT");

    for (const config of ENTITIES) {
      status.entity = config.key;
      status.step = `Exporting ${config.key}`;
      saveStatus(jobId, status);

      const fullUrl = `${baseUrl}${config.endpoint}`;
      const outFile = path.join(jobDir, config.category, config.filename);
      const writeStream = fs.createWriteStream(outFile, { encoding: 'utf-8' });

      log(config.key, `Starting export to ${config.category}/${config.filename}`);

      try {
        const generator = fetchODataPages(fullUrl, token, (msg) => log(config.key, msg));

        let count = 0;
        let headers: string[] | null = null;
        let pageCount = 0;

        for await (const page of generator) {
           pageCount++;
           status.page = pageCount;
           status.totalItems = (status.totalItems || 0) + page.items.length;
           // throttle updates to avoid disk thrashing?
           if (pageCount % 5 === 0) saveStatus(jobId, status);

           if (!page.items || page.items.length === 0) continue;
           const items = page.items as Record<string, unknown>[];

           if (!headers) {
             headers = Object.keys(items[0]);
             writeStream.write('\ufeff'); // BOM
             writeStream.write(headers.map(h => safeCsvField(h)).join(',') + '\n');
           }

           for (const item of items) {
             const row = headers.map(k => safeCsvField(item[k]));
             writeStream.write(row.join(',') + '\n');
             count++;
           }
        }

        writeStream.end();
        entityStats[config.key] = { count, status: 'OK', endpoint: config.endpoint };
        log(config.key, `Finished. ${count} items.`);

      } catch (err) {
        writeStream.end();
        const msg = err instanceof Error ? err.message : String(err);
        log(config.key, `FAILED: ${msg}`, 'ERROR');
        entityStats[config.key] = { count: 0, status: 'FAIL', endpoint: config.endpoint };
      }
    }

    // Generate Index XLSX
    status.step = "Generating Report";
    saveStatus(jobId, status);

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

    await workbook.xlsx.writeFile(path.join(jobDir, 'index.xlsx'));

    // Save Logs CSV
    fs.writeFileSync(path.join(jobDir, 'metadata', 'extraction_log.csv'), extractionLogs.join('\n'));

    status.status = 'done';
    status.step = 'Completed';
    status.finishedAt = new Date().toISOString();
    saveStatus(jobId, status);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Job ${jobId} failed:`, err);
    status.status = 'error';
    status.errorMessage = msg;
    saveStatus(jobId, status);
  }
}
