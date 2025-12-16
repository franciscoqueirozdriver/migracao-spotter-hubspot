// lib/companies.ts
import fs from 'fs';
import path from 'path';
import { sanitizeCsvValue, buildCsv } from './csv';

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

// --- HubSpot CSV Configuration ---
const COMPANY_HEADERS = [
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
  'spotter_organization_id',
];

// --- Normalization Functions ---

function normalizeCnpj(value?: string | null): string {
  if (!value) return '';
  return value.replace(/\D/g, '');
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

// --- Main Export Logic ---

export async function exportCompaniesToCsv(
  token: string,
  log: LogCallback
): Promise<{ csvContent: string; logData: CompanyExportLog }> {
  log('Iniciando exportação de empresas...');

  const allOrgs = await fetchAllSpotterOrganizations(token, log);
  log(`Total de ${allOrgs.length} organizações recebidas do Spotter.`);

  const csvRows: string[][] = [];
  const invalidSamples: { id: string; name: string; reason: string }[] = [];
  const warningSamples: { id: string; name: string; reason: string }[] = [];

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

    const normalizedCnpj = normalizeCnpj(org.cpfCnpj);

    const row = [
      sanitizeCsvValue(org.name),
      sanitizeCsvValue(extractDomain(org.website)),
      sanitizeCsvValue(normalizedCnpj),
      sanitizeCsvValue(org.street),
      sanitizeCsvValue(org.number),
      sanitizeCsvValue(org.complement),
      sanitizeCsvValue(org.neighborhood),
      sanitizeCsvValue(org.zipCode),
      sanitizeCsvValue(org.city),
      sanitizeCsvValue(org.state),
      sanitizeCsvValue(org.country),
      sanitizeCsvValue(org.id),
    ];
    csvRows.push(row);
  }

  log(`Processamento concluído. ${csvRows.length} empresas serão exportadas.`);
  log(`${skippedCount} empresas puladas por dados inválidos (sem nome).`);
  log(`${warningCount} empresas marcadas com aviso (sem website e sem CNPJ).`);

  const csvContent = buildCsv(COMPANY_HEADERS, csvRows);
  log('Conteúdo CSV gerado.');

  const logData: CompanyExportLog = {
    timestamp: new Date().toISOString(),
    stats: {
      totalReceived: allOrgs.length,
      totalExported: csvRows.length,
      totalSkippedInvalid: skippedCount,
      totalWithWarning: warningCount,
    },
    invalidSamples,
    warningSamples,
  };

  // Save log file
  try {
    const exportsDir = path.join('/tmp', 'exports');
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
