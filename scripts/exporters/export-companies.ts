
import path from 'path';
import fs from 'fs';
import { paginateOData } from '../../lib/exactSpotter/paginate';
import { generateCsvFromRows } from '../../lib/csv/writer';
import { SpotterOrganization } from './types';

// Headers exatos solicitados:
// Nome da empresa,Nome de domínio da empresa,CNPJ,Endereço,Número,Complemento,Bairro,Código postal,Cidade,Estado/Região,País/Região,spotter_organization_id

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

export async function runExportCompanies(outputDir: string, token: string, baseUrl: string): Promise<void> {
  console.log('--- Starting Companies Export (empresas.csv) ---');

  const endpoint = '/v3/organization';
  const orgs = await paginateOData<SpotterOrganization>(baseUrl, endpoint, token, console.log);

  console.log(` fetched ${orgs.length} organizations.`);

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
    normalizeCnpj(org.cpfCnpj), // Assumes API returns cpfCnpj field, need to verify strict interface
    org.street ?? '',
    org.number ?? '',
    org.complement ?? '',
    org.neighborhood ?? '',
    org.zipCode ?? '',
    org.city ?? '',
    org.state ?? '',
    org.country ?? '',
    org.id
  ]);

  const csvContent = generateCsvFromRows(headers, rows);
  const filePath = path.join(outputDir, 'empresas.csv');

  // Write with BOM for Excel
  fs.writeFileSync(filePath, '\ufeff' + csvContent);
  console.log(`Saved empresas.csv to ${filePath}`);
}
