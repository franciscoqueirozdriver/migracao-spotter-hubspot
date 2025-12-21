
import { paginateOData } from '../exactSpotter/paginate';
import { generateCsvFromRows } from '../csv/writer';
import { LogCallback } from '../exporter';

// Redefine types if needed to avoid cross-project dependency issues with 'scripts' which might be excluded from build
interface SpotterOrg {
    id: number;
    name: string;
    website?: string | null;
    cpfCnpj?: string | null;
    street?: string | null;
    number?: string | null;
    complement?: string | null;
    neighborhood?: string | null;
    zipCode?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
}

function extractDomain(url?: string | null): string {
    if (!url) return '';
    try {
      let domain = url;
      if (!domain.startsWith('http')) {
        domain = `http://${domain}`;
      }
      const hostname = new URL(domain).hostname;
      return hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
}

function normalizeCnpj(value?: string | null): string {
    if (!value) return '';
    return value.replace(/\D/g, '');
}

export async function generateCompaniesCsvStrict(token: string, baseUrl: string, log: LogCallback): Promise<string> {
  log('--- Starting Companies Export (empresas.csv) ---');

  const endpoint = '/v3/organization';
  const orgs = await paginateOData<SpotterOrg>(baseUrl, endpoint, token, log);

  log(` fetched ${orgs.length} organizations.`);

  // Prepare CSV
  const headers = [
    'Nome da empresa',
    'Nome de domínio da empresa',
    'CNPJ',
    'Endereço',
    'Número',
    'Complemento',
    'Bairro',
    'Código postal',
    'Cidade',
    'Estado/Região',
    'País/Região',
    'spotter_organization_id'
  ];

  const rows = orgs.map(org => [
    org.name ?? '',
    extractDomain(org.website),
    normalizeCnpj(org.cpfCnpj),
    org.street ?? '',
    org.number ?? '',
    org.complement ?? '',
    org.neighborhood ?? '',
    org.zipCode ?? '',
    org.city ?? '',
    org.state ?? '',
    org.country ?? '',
    String(org.id)
  ]);

  // Use the writer that adds BOM
  // generateCsvFromRows in 'lib/csv/writer.ts' likely doesn't add BOM by itself,
  // but we can prepend it here or ensure the writer does.
  // Looking at previous turn, I wrote 'lib/csv/writer.ts'. Let's check it.
  // Wait, I created 'scripts/exporters/export-companies.ts' which manually added BOM.
  // I should use the same logic here.

  const csvContent = generateCsvFromRows(headers, rows);
  return '\ufeff' + csvContent;
}
