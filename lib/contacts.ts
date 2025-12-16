// lib/contacts.ts
import fs from 'fs';
import path from 'path';
import { fetchAllSpotterOData, ODataResponse } from './spotter';
import { sanitizeCsvValue, buildCsv } from './csv';

// --- Type Definitions ---

export interface SpotterPerson {
  id: number;
  leadId: number;
  email?: string | null;
  name?: string | null;
  jobTitle?: string | null;
  phone1?: string | null;
  phone2?: string | null;
  mainContact?: boolean | null;
  messagingPlatform?: string | null;
  idMessagingPlataform?: string | null;
}

export interface SpotterLead {
  id: number;
  // Adicione mais campos de lead se necessário no futuro
}

export interface HubSpotContactRow {
  'E-mail': string;
  'Nome': string;
  'Sobrenome': string;
  'Cargo': string;
  'Telefone': string;
  'Telefone 2': string;
  'spotter_person_id': string;
  'spotter_lead_id': string;
  'spotter_main_contact': string;
  'spotter_messaging_platform': string;
  'spotter_messaging_id': string;
}

export type RejectReason = 'NO_EMAIL' | 'DUPLICATE_EMAIL' | 'SINGLE_NAME_NO_LASTNAME' | 'OTHER';

export interface HubSpotRejectedContactRow extends HubSpotContactRow {
  reject_reason: RejectReason;
  reject_detail: string;
}

export interface ExportContactsStats {
  fetchStrategy: 'global' | 'per-lead' | 'none';
  receivedLeads: number;
  receivedPersons: number;
  validContacts: number;
  skippedNoEmail: number;
  skippedDuplicates: number;
  warnings: {
    singleNameNoLastname: number;
  };
}

interface ExportLog {
  timestamp: string;
  stats: ExportContactsStats;
  warnings: { email: string; reason: string; }[];
  errors: { message: string; }[];
}

type LogCallback = (message: string) => void;

// --- HubSpot CSV Configuration ---
const CONTACT_HEADERS: (keyof HubSpotContactRow)[] = [
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
  'spotter_messaging_id',
];

// --- Data Fetching ---

async function fetchAllPersonsGlobally(token: string, log: LogCallback): Promise<SpotterPerson[]> {
  const initialUrl = 'https://api.exactspotter.com/v3/Persons';
  return await fetchAllSpotterOData<SpotterPerson>(initialUrl, token, log);
}

async function fetchAllLeads(token: string, log: LogCallback): Promise<SpotterLead[]> {
  // O endpoint de leads pode variar, ajuste se necessário.
  // Usando /v3/leads como um padrão OData.
  const initialUrl = 'https://api.exactspotter.com/v3/leads';
  log('Buscando todos os leads para a estratégia de fallback...');
  return await fetchAllSpotterOData<SpotterLead>(initialUrl, token, log);
}

async function fetchPersonsByLead(leadId: number, token: string, log: LogCallback): Promise<SpotterPerson[]> {
  const url = `https://api.exactspotter.com/v3/Persons/${leadId}`;
  try {
    // Reutiliza a função genérica que já lida com a paginação OData.
    // Isso garante que, se a API retornar um nextLink, todas as páginas de contatos para o lead serão buscadas.
    return await fetchAllSpotterOData<SpotterPerson>(url, token, log);
  } catch (error) {
    // Se a busca para um lead específico falhar, loga o erro e retorna um array vazio
    // para não parar a exportação inteira.
    log(`ERRO: Falha ao buscar contatos para o lead ${leadId}. Motivo: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    return [];
  }
}


// --- Data Processing and CSV Generation ---

function splitName(fullName?: string | null): { firstName: string; lastName: string; wasSplit: boolean } {
  if (!fullName) {
    return { firstName: '', lastName: '', wasSplit: false };
  }
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] ?? '';
  const lastName = parts.slice(1).join(' ');

  if (firstName && !lastName) {
    return { firstName, lastName: '-', wasSplit: false };
  }

  return { firstName, lastName, wasSplit: true };
}

interface ProcessedContacts {
  validRows: HubSpotContactRow[];
  rejectedRows: HubSpotRejectedContactRow[];
}

function processAndDeduplicatePersons(
  persons: SpotterPerson[],
  stats: ExportContactsStats,
  logWarnings: (email: string, reason: string) => void
): ProcessedContacts {
  const seenEmails = new Set<string>();
  const validRows: HubSpotContactRow[] = [];
  const rejectedRows: HubSpotRejectedContactRow[] = [];

  for (const person of persons) {
    const email = person.email?.trim().toLowerCase();

    const baseRow = {
      'E-mail': person.email ?? '',
      'Nome': splitName(person.name).firstName,
      'Sobrenome': splitName(person.name).lastName,
      'Cargo': person.jobTitle ?? '',
      'Telefone': person.phone1 ?? '',
      'Telefone 2': person.phone2 ?? '',
      'spotter_person_id': String(person.id),
      'spotter_lead_id': String(person.leadId),
      'spotter_main_contact': String(person.mainContact ?? false),
      'spotter_messaging_platform': person.messagingPlatform ?? '',
      'spotter_messaging_id': person.idMessagingPlataform ?? '',
    };

    if (!email) {
      stats.skippedNoEmail++;
      rejectedRows.push({
        ...baseRow,
        reject_reason: 'NO_EMAIL',
        reject_detail: 'O campo de e-mail está vazio.',
      });
      continue;
    }

    if (seenEmails.has(email)) {
      stats.skippedDuplicates++;
      rejectedRows.push({
        ...baseRow,
        reject_reason: 'DUPLICATE_EMAIL',
        reject_detail: `O e-mail '${email}' já foi processado.`,
      });
      continue;
    }

    seenEmails.add(email);

    const { firstName, lastName, wasSplit } = splitName(person.name);
    if (!wasSplit && lastName === '-') {
      stats.warnings.singleNameNoLastname++;
      logWarnings(email, `Nome '${person.name}' resultou em sobrenome '-'`);
    }

    const row: HubSpotContactRow = {
      'E-mail': email,
      'Nome': firstName,
      'Sobrenome': lastName,
      'Cargo': person.jobTitle ?? '',
      'Telefone': person.phone1 ?? '',
      'Telefone 2': person.phone2 ?? '',
      'spotter_person_id': String(person.id),
      'spotter_lead_id': String(person.leadId),
      'spotter_main_contact': String(person.mainContact ?? false),
      'spotter_messaging_platform': person.messagingPlatform ?? '',
      'spotter_messaging_id': person.idMessagingPlataform ?? '',
    };
    validRows.push(row);
  }

  stats.validContacts = validRows.length;
  return { validRows, rejectedRows };
}


// --- Main Export Orchestrator ---

export async function exportContactsToCsv(
  token: string,
  log: LogCallback
): Promise<{ csvContent: string; rejectedCsvContent: string; logData: ExportLog }> {
  log('Iniciando exportação de contatos...');

  const stats: ExportContactsStats = {
    fetchStrategy: 'none',
    receivedLeads: 0,
    receivedPersons: 0,
    validContacts: 0,
    skippedNoEmail: 0,
    skippedDuplicates: 0,
    warnings: { singleNameNoLastname: 0 },
  };

  const logFile: ExportLog = {
    timestamp: new Date().toISOString(),
    stats,
    warnings: [],
    errors: [],
  };

  const logWarning = (email: string, reason: string) => {
    if (logFile.warnings.length < 100) { // Limita o número de amostras
      logFile.warnings.push({ email, reason });
    }
  };

  let allPersons: SpotterPerson[] = [];

  try {
    log('Tentando buscar todos os contatos com o endpoint global /v3/Persons...');
    allPersons = await fetchAllPersonsGlobally(token, log);
    stats.fetchStrategy = 'global';
    log('Sucesso! O endpoint global de contatos é suportado.');

  } catch (error) {
    log('Endpoint global /v3/Persons não suportado. Usando fallback para busca por lead.');
    log(`Motivo: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    stats.fetchStrategy = 'per-lead';

    try {
      const leads = await fetchAllLeads(token, log);
      stats.receivedLeads = leads.length;
      log(`Encontrados ${leads.length} leads. Buscando contatos para cada um...`);

      for (const lead of leads) {
        const personsFromLead = await fetchPersonsByLead(lead.id, token, log);
        allPersons.push(...personsFromLead);
      }

    } catch (leadError) {
      const errorMessage = leadError instanceof Error ? leadError.message : 'Erro desconhecido ao buscar leads.';
      log(`ERRO CRÍTICO: Falha ao buscar leads na estratégia de fallback. ${errorMessage}`);
      logFile.errors.push({ message: errorMessage });
      // Retorna o que foi processado até agora, se houver
    }
  }

  stats.receivedPersons = allPersons.length;
  log(`Total de ${stats.receivedPersons} registros de contatos recebidos.`);

  log('Processando e deduplicando contatos...');
  const { validRows, rejectedRows } = processAndDeduplicatePersons(allPersons, stats, logWarning);
  log(`Processamento concluído. ${stats.validContacts} contatos válidos para exportação.`);
  log(`${stats.skippedNoEmail} contatos ignorados por falta de e-mail.`);
  log(`${stats.skippedDuplicates} contatos duplicados (por e-mail) ignorados.`);
  log(`${stats.warnings.singleNameNoLastname} contatos com nome único (sobrenome definido como '-').`);

  log('Gerando arquivo CSV para contatos válidos...');
  const csvRows = validRows.map(row =>
    CONTACT_HEADERS.map(header => sanitizeCsvValue(row[header]))
  );
  const csvContent = buildCsv(CONTACT_HEADERS, csvRows);
  log('Geração do CSV de contatos válidos concluída.');

  log('Gerando arquivo CSV para contatos rejeitados...');
  const rejectedHeaders: (keyof HubSpotRejectedContactRow)[] = [
    ...CONTACT_HEADERS,
    'reject_reason',
    'reject_detail',
  ];
  const rejectedCsvRows = rejectedRows.map(row =>
    rejectedHeaders.map(header => sanitizeCsvValue(row[header]))
  );
  const rejectedCsvContent = buildCsv(rejectedHeaders, rejectedCsvRows);
  log(`Geração do CSV de contatos rejeitados concluída com ${rejectedRows.length} linhas.`);

  // Save log file
  try {
    const exportsDir = path.join(process.cwd(), 'exports');
    fs.mkdirSync(exportsDir, { recursive: true });
    const logFilePath = path.join(exportsDir, 'spotter_to_hubspot_contatos.log.json');
    fs.writeFileSync(logFilePath, JSON.stringify(logFile, null, 2));
    log(`Arquivo de log salvo em: ${logFilePath}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    log(`ERRO ao salvar o arquivo de log: ${errorMessage}`);
    logFile.errors.push({ message: `Failed to save log file: ${errorMessage}` });
  }

  return { csvContent, rejectedCsvContent, logData: logFile };
}
