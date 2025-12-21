
import path from 'path';
import fs from 'fs';
import { paginateOData } from '../../lib/exactSpotter/paginate';
import { generateCsvFromRows } from '../../lib/csv/writer';
import { SpotterLead } from './types';

export async function runExportLeads(outputDir: string, token: string, baseUrl: string): Promise<SpotterLead[]> {
  console.log('--- Starting Leads Baseline Export ---');

  const endpoint = '/v3/leads';
  const leads = await paginateOData<SpotterLead>(baseUrl, endpoint, token, console.log);

  console.log(` fetched ${leads.length} leads.`);

  // Prepare CSV
  const headers = [
    'id',
    'organizationId',
    'stage',
    'pipeline',
    'source',
    'value',
    'userId',
    'creationDate'
  ];

  const rows = leads.map(lead => [
    lead.id,
    lead.organizationId,
    lead.stage,
    lead.pipeline,
    lead.source,
    lead.value,
    lead.userId,
    lead.creationDate
  ]);

  const csvContent = generateCsvFromRows(headers, rows);
  const filePath = path.join(outputDir, 'leads_all.csv');

  fs.writeFileSync(filePath, csvContent);
  console.log(`Saved leads_all.csv to ${filePath}`);

  return leads;
}
