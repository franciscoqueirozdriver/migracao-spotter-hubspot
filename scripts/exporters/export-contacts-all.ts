
import path from 'path';
import fs from 'fs';
import { paginateOData } from '../../lib/exactSpotter/paginate';
import { generateCsvFromRows } from '../../lib/csv/writer';
import { SpotterPerson } from './types';

export async function runExportContacts(outputDir: string, token: string, baseUrl: string): Promise<SpotterPerson[]> {
  console.log('--- Starting Contacts Baseline Export ---');

  // NOTE: Assuming /v3/persons exists and works for global export based on project context
  // If this endpoint is not available globally, we might need a different strategy,
  // but for a baseline audit, we assume we can list all persons.
  const endpoint = '/v3/persons';

  try {
    const persons = await paginateOData<SpotterPerson>(baseUrl, endpoint, token, console.log);

    console.log(` fetched ${persons.length} persons.`);

    // Prepare CSV
    const headers = [
      'id',
      'email',
      'name',
      'linkedIn',
      'phone',
      'role',
      'leadId',
      'mainContact'
    ];

    const rows = persons.map(p => [
      p.id,
      p.email,
      p.name,
      p.linkedIn,
      p.phone,
      p.role,
      p.leadId,
      p.mainContact
    ]);

    const csvContent = generateCsvFromRows(headers, rows);
    const filePath = path.join(outputDir, 'contacts_all.csv');

    fs.writeFileSync(filePath, csvContent);
    console.log(`Saved contacts_all.csv to ${filePath}`);

    return persons;
  } catch (error) {
      console.warn('Could not fetch contacts (global endpoint might not be available). Skipping contacts export.');
      // Stub file to indicate attempt
      fs.writeFileSync(path.join(outputDir, 'contacts_all_ERROR.txt'), `Error fetching contacts: ${error}`);
      return [];
  }
}
