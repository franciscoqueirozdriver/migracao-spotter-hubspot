
import { paginateOData } from '../exactSpotter/paginate';
import { generateCsvFromRows } from '../csv/writer';
import { LogCallback, ExportLog } from '../exporter';

interface SpotterPerson {
    id: number;
    email?: string | null;
    name?: string | null;
    phone?: string | null;
    role?: string | null;
    leadId?: number | null;
    mainContact?: boolean | null;
}

function splitName(fullName?: string | null): { firstName: string, lastName: string } {
    if (!fullName) return { firstName: '', lastName: '' };
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 0) return { firstName: '', lastName: '' };
    if (parts.length === 1) return { firstName: parts[0], lastName: '-' };

    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');
    return { firstName, lastName };
}

export async function generateContactsCsvStrict(token: string, baseUrl: string, log: LogCallback, currentLog: ExportLog): Promise<string> {
  log('--- Starting Contacts Export (contatos.csv) ---');

  const endpoint = '/v3/persons';
  const persons = await paginateOData<SpotterPerson>(baseUrl, endpoint, token, log);

  currentLog.totals.recordsFetched = persons.length;
  log(` fetched ${persons.length} persons.`);

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
        '', // Telefone 2
        String(p.id),
        String(p.leadId ?? ''),
        p.mainContact ? 'true' : 'false',
        '', // spotter_messaging_platform
        ''  // spotter_messaging_id
    ];
  });

  currentLog.totals.recordsGenerated = rows.length;

  const csvContent = generateCsvFromRows(headers, rows);
  return '\ufeff' + csvContent;
}
