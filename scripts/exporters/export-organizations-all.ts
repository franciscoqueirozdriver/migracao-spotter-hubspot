
import path from 'path';
import fs from 'fs';
import { paginateOData } from '../../lib/exactSpotter/paginate';
import { generateCsvFromRows } from '../../lib/csv/writer';
import { SpotterOrganization } from './types';

export async function runExportOrganizations(outputDir: string, token: string, baseUrl: string): Promise<SpotterOrganization[]> {
  console.log('--- Starting Organizations Baseline Export ---');

  const endpoint = '/v3/organization';
  const orgs = await paginateOData<SpotterOrganization>(baseUrl, endpoint, token, console.log);

  console.log(` fetched ${orgs.length} organizations.`);

  // Prepare CSV
  const headers = [
    'id',
    'name',
    'website',
    'phone',
    'industry',
    'subIndustry',
    'employees',
    'revenue'
  ];

  const rows = orgs.map(org => [
    org.id,
    org.name,
    org.website,
    org.phone,
    org.industry,
    org.subIndustry,
    org.employees,
    org.revenue
  ]);

  const csvContent = generateCsvFromRows(headers, rows);
  const filePath = path.join(outputDir, 'organizations_all.csv');

  fs.writeFileSync(filePath, csvContent);
  console.log(`Saved organizations_all.csv to ${filePath}`);

  return orgs;
}
