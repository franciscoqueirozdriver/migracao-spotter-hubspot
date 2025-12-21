
import path from 'path';
import fs from 'fs';
import { paginateOData } from '../../lib/exactSpotter/paginate';
import { generateCsvFromRows } from '../../lib/csv/writer';
import { SpotterPerson } from './types';

// Headers exatos solicitados:
// E-mail,Nome,Sobrenome,Cargo,Telefone,Telefone 2,spotter_person_id,spotter_lead_id,spotter_main_contact,spotter_messaging_platform,spotter_messaging_id

function splitName(fullName?: string | null): { firstName: string, lastName: string } {
    if (!fullName) return { firstName: '', lastName: '' };
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 0) return { firstName: '', lastName: '' };
    if (parts.length === 1) return { firstName: parts[0], lastName: '-' }; // Placeholder for last name if single word

    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');
    return { firstName, lastName };
}

export async function runExportContacts(outputDir: string, token: string, baseUrl: string): Promise<void> {
  console.log('--- Starting Contacts Export (contatos.csv) ---');

  const endpoint = '/v3/persons';
  const persons = await paginateOData<SpotterPerson>(baseUrl, endpoint, token, console.log);

  console.log(` fetched ${persons.length} persons.`);

  // Prepare CSV
  const headers = [
    'E-mail',
    'Nome',
    'Sobrenome',
    'Cargo',
    'Telefone',
    'Telefone 2',
    'spotter_person_id',
    'spotter_lead_id',
    'spotter_main_contact',
    'spotter_messaging_platform',
    'spotter_messaging_id'
  ];

  const rows = persons.map(p => {
    const { firstName, lastName } = splitName(p.name);
    return [
        p.email ?? '',
        firstName,
        lastName,
        p.role ?? '',
        p.phone ?? '',
        '', // Telefone 2 (API field verification needed, assuming empty for now based on types.ts)
        p.id,
        p.leadId ?? '',
        p.mainContact ? 'true' : 'false',
        '', // spotter_messaging_platform (not in baseline types)
        ''  // spotter_messaging_id
    ];
  });

  const csvContent = generateCsvFromRows(headers, rows);
  const filePath = path.join(outputDir, 'contatos.csv');

  // Write with BOM for Excel
  fs.writeFileSync(filePath, '\ufeff' + csvContent);
  console.log(`Saved contatos.csv to ${filePath}`);
}
