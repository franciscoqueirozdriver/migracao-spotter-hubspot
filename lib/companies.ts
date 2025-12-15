// lib/companies.ts
import fs from 'fs';
import path from 'path';

// Type definitions for Spotter API response
export interface SpotterOrganization {
  id: string;
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
  phones?: { phone: string }[] | null;
  registerDate?: string;
  updateDate?: string;
}

export type ODataResponse<T> = {
  value?: T[];
  ['@odata.nextLink']?: string;
};

// Type definition for HubSpot company CSV data
export interface HubSpotCompany {
  'Nome da empresa': string;
  'Nome de domínio da empresa': string;
  'CNPJ': string;
  'Endereço': string;
  'Número': string;
  'Complemento': string;
  'Bairro': string;
  'Código postal': string;
  'Cidade': string;
  'Estado/Região': string;
  'País/Região': string;
  'spotter_organization_id': string;
}

// Type definition for the logging callback
type LogCallback = (message: string) => void;

// Type definition for logs
interface CompanyExportLog {
  timestamp: string;
  stats: {
    totalReceived: number;
    totalExported: number;
    totalSkippedInvalid: number;
    totalWithWarning: number;
  };
  invalidSamples: { id: string; name: string; reason: string }[];
  warningSamples: { id: string; name: string; reason: string }[];
}

// --- Normalization Functions ---

function normalizeCnpj(value?: string | null): string {
  if (!value) return '';
  return value.replace(/\D/g, '');
}

function extractDomain(url?: string | null): string {
  if (!url) return '';
  try {
    const domain = new URL(url).hostname;
    return domain.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

// --- API Fetching ---

async function fetchAllSpotterOrganizations(
  token: string,
  log: LogCallback
): Promise<SpotterOrganization[]> {
  let allOrgs: SpotterOrganization[] = [];
  let nextUrl: string | undefined = 'https://api.exactspotter.com/v3/organization';
  let page = 1;

  while (nextUrl) {
    log(`Buscando página ${page} de organizações...`);
    const response = await fetch(nextUrl, {
      headers: { 'token_exact': token },
    });

    if (!response.ok) {
      const errorText = `A API do Spotter retornou um erro: ${response.status} ${response.statusText}.`;
      log(`ERRO: ${errorText}`);
      throw new Error(errorText);
    }

    const data: ODataResponse<SpotterOrganization> = await response.json();
    const orgs = data.value ?? [];

    if (orgs.length === 0) {
      log('Recebida uma página vazia. Finalizando a busca.');
      break;
    }

    allOrgs = allOrgs.concat(orgs);
    log(`Recebidas ${orgs.length} organizações.`);
    nextUrl = data['@odata.nextLink'];
    page++;
  }

  return allOrgs;
}

// --- CSV Generation ---

function escapeCsvField(field: string | number): string {
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function generateCsvContent(companies: HubSpotCompany[]): string {
  if (companies.length === 0) {
    return '';
  }
  const headers = Object.keys(companies[0]);
  const csvRows = companies.map(company =>
    headers.map(header => escapeCsvField(company[header as keyof HubSpotCompany])).join(',')
  );
  return [headers.join(','), ...csvRows].join('\n');
}

// --- Main Export Logic ---

export async function exportCompaniesToCsv(
  token: string,
  log: LogCallback
): Promise<{ csvContent: string; logData: CompanyExportLog }> {
  log('Iniciando exportação de empresas...');

  const allOrgs = await fetchAllSpotterOrganizations(token, log);
  log(`Total de ${allOrgs.length} organizações recebidas do Spotter.`);

  const hubspotCompanies: HubSpotCompany[] = [];
  const invalidSamples: { id: string; name: string; reason: string }[] = [];
  const warningSamples: { id:string; name: string; reason: string }[] = [];

  let skippedCount = 0;
  let warningCount = 0;

  for (const org of allOrgs) {
    // Validation: Skip if name is missing
    if (!org.name) {
      skippedCount++;
      if (invalidSamples.length < 50) {
        invalidSamples.push({ id: org.id, name: '(sem nome)', reason: 'Nome da empresa ausente' });
      }
      continue;
    }

    // Warning: Check for missing website and CNPJ
    if (!org.website && !org.cpfCnpj) {
      warningCount++;
      if (warningSamples.length < 50) {
        warningSamples.push({ id: org.id, name: org.name, reason: 'Website e CNPJ ausentes' });
      }
    }

    const fullAddress = [org.street, org.number].filter(Boolean).join(', ');

    const hubspotCompany: HubSpotCompany = {
      'Nome da empresa': org.name,
      'Nome de domínio da empresa': extractDomain(org.website),
      'CNPJ': normalizeCnpj(org.cpfCnpj),
      'Endereço': fullAddress,
      'Número': org.number || '',
      'Complemento': org.complement || '',
      'Bairro': org.neighborhood || '',
      'Código postal': org.zipCode || '',
      'Cidade': org.city || '',
      'Estado/Região': org.state || '',
      'País/Região': org.country || '',
      'spotter_organization_id': org.id,
    };
    hubspotCompanies.push(hubspotCompany);
  }

  log(`Processamento concluído. ${hubspotCompanies.length} empresas serão exportadas.`);
  log(`${skippedCount} empresas puladas por dados inválidos (sem nome).`);
  log(`${warningCount} empresas marcadas com aviso (sem website e sem CNPJ).`);

  const csvContent = generateCsvContent(hubspotCompanies);
  log('Conteúdo CSV gerado.');

  const logData: CompanyExportLog = {
    timestamp: new Date().toISOString(),
    stats: {
      totalReceived: allOrgs.length,
      totalExported: hubspotCompanies.length,
      totalSkippedInvalid: skippedCount,
      totalWithWarning: warningCount,
    },
    invalidSamples,
    warningSamples,
  };

  // Save log file
  try {
    const exportsDir = path.join(process.cwd(), 'exports');
    fs.mkdirSync(exportsDir, { recursive: true });
    const logFilePath = path.join(exportsDir, 'logs_empresas.json');
    fs.writeFileSync(logFilePath, JSON.stringify(logData, null, 2));
    log(`Arquivo de log salvo em: ${logFilePath}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    log(`ERRO ao salvar o arquivo de log: ${errorMessage}`);
  }

  return { csvContent, logData };
}
