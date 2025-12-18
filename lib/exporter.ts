// lib/exporter.ts
import { fetchAllSpotterOData } from './spotter';
import { buildCsv, sanitizeCsvValue } from './csv';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

//region Type Definitions
export type LogCallback = (message: string) => void;
export type ExportMode = 'sold' | 'open' | 'lost' | 'custom';
export type ExportableEntity = 'companies' | 'contacts' | 'deals' | 'lineItems';

// Spotter API Interfaces
export interface SpotterLeadSold {
  leadId: number;
  saleDate: string;
  id: number;
  products?: { id: number; name?: string; quantity?: number; individualValue?: number }[];
}

export interface SpotterLead {
  id: number;
  lead?: string;
  organizationId?: number;
  source?: { value?: string };
  stage?: { value?: string };
}

export interface SpotterOrganization {
    id: number;
    name?: string;
    socialCnpj?: string;
    website?: string;
}

export interface SpotterPerson {
  id: number;
  name?: string;
  mainContact?: boolean;
  leadId?: number;
  emails?: { address?: string }[];
  phones?: { number?: string }[];
}

// Log object for run.json
interface RunLog {
  runId: string;
  mode: ExportMode;
  entities: ExportableEntity[];
  startTime: string;
  endTime?: string;
  counts: Record<string, number>;
  warnings: { message: string; data?: unknown }[];
  errors: { message: string; details: unknown }[];
}
//endregion

//region Utility Functions
function formatDateBR(isoString?: string): string {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

function mapOrigemComercialReal(sourceValue?: string): string {
    if (!sourceValue) return 'Inbound';
    const normalized = sourceValue.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (normalized.includes('prospeccao ativa')) return 'Outbound';
    if (normalized.includes('carteira de clientes')) return 'White Space (Base)';
    return 'Inbound';
}

function splitName(fullName: string = ''): { firstName: string; lastName: string } {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return { firstName: parts[0], lastName: '-' };
    const firstName = parts.shift() || '';
    const lastName = parts.join(' ');
    return { firstName, lastName };
}
//endregion

//region Data Fetching
// Generic fetchers
const fetchLeads = async (token: string, baseUrl: string, log: LogCallback, filters?: string) => {
    const url = `${baseUrl}/v3/Leads${filters ? `?$filter=${filters}` : ''}`;
    return fetchAllSpotterOData<SpotterLead>(url, token, log);
};
const fetchLeadsSold = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterLeadSold>(`${baseUrl}/v3/LeadsSold`, token, log);
const fetchOrganizations = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterOrganization>(`${baseUrl}/v3/organization`, token, log);
const fetchPersons = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterPerson>(`${baseUrl}/v3/Persons/`, token, log);

// Caching maps to avoid re-fetching data
type DataCache = {
    leads?: Map<number, SpotterLead>;
    persons?: Map<number, SpotterPerson[]>;
    mainPersonByLead?: Map<number, SpotterPerson | undefined>;
    organizations?: Map<number, SpotterOrganization>;
    leadsSold?: SpotterLeadSold[];
};
//endregion

//region Entity Exporters
async function exportCompanies(runId: string, cache: DataCache, runLog: RunLog, token: string, baseUrl: string, log: LogCallback) {
    log('Exportando Empresas...');
    if (!cache.organizations) {
        const orgs = await fetchOrganizations(token, baseUrl, log);
        cache.organizations = new Map(orgs.map(o => [o.id, o]));
        runLog.counts.fetchedOrganizations = orgs.length;
    }

    const rows = Array.from(cache.organizations.values()).map(org => ({
        'ID da Empresa no Spotter': org.id,
        'Nome da Empresa': org.name || '',
        'Domínio da Empresa': org.website || '',
        'CNPJ': org.socialCnpj ? `="${org.socialCnpj}"` : '', // Excel formula format
    }));

    await writeCsv(runId, 'companies', Object.keys(rows[0]), rows, log);
    runLog.counts.exportedCompanies = rows.length;
}

async function exportContacts(runId: string, cache: DataCache, runLog: RunLog, token: string, baseUrl: string, log: LogCallback) {
    log('Exportando Contatos...');
    if (!cache.persons) {
        const persons = await fetchPersons(token, baseUrl, log);
        cache.persons = new Map();
        for (const person of persons) {
            const leadId = person.leadId ?? 0;
            if (!cache.persons.has(leadId)) cache.persons.set(leadId, []);
            cache.persons.get(leadId)!.push(person);
        }
        runLog.counts.fetchedPersons = persons.length;
    }

    const allPersons = Array.from(cache.persons.values()).flat();
    const rows = allPersons.map(person => {
        const { firstName, lastName } = splitName(person.name);
        return {
            'ID do Contato no Spotter': person.id,
            'Email': person.emails?.[0]?.address ?? '',
            'Nome': firstName,
            'Sobrenome': lastName,
            'Telefone': person.phones?.[0]?.number ?? '',
            'Lead ID': person.leadId ?? '',
        };
    });

    await writeCsv(runId, 'contacts', Object.keys(rows[0]), rows, log);
    runLog.counts.exportedContacts = rows.length;
}

async function exportDealsAndLineItems(runId: string, cache: DataCache, runLog: RunLog, token: string, baseUrl: string, log: LogCallback, exportLineItems: boolean) {
    log('Exportando Negócios...');
    if (exportLineItems) log('...e Itens de Linha.');

    // Dependencies
    if (!cache.leadsSold) {
        cache.leadsSold = await fetchLeadsSold(token, baseUrl, log);
        runLog.counts.fetchedLeadsSold = cache.leadsSold.length;
    }
    if (!cache.leads) {
        const leads = await fetchLeads(token, baseUrl, log);
        cache.leads = new Map(leads.map(l => [l.id, l]));
        runLog.counts.fetchedLeads = leads.length;
    }
    if (!cache.mainPersonByLead) {
        const persons = await fetchPersons(token, baseUrl, log);
        const personsByLead = new Map<number, SpotterPerson[]>();
        for (const p of persons) {
            if (p.leadId) {
                if (!personsByLead.has(p.leadId)) personsByLead.set(p.leadId, []);
                personsByLead.get(p.leadId)!.push(p);
            }
        }
        cache.mainPersonByLead = new Map();
        personsByLead.forEach((pList, leadId) => {
            cache.mainPersonByLead!.set(leadId, pList.find(p => p.mainContact) ?? pList[0]);
        });
        runLog.counts.fetchedPersons = persons.length;
    }

    const dealRows: any[] = [];
    const lineItemRows: any[] = [];
    const invalidDeals: any[] = [];

    for (const sale of cache.leadsSold) {
        const lead = cache.leads.get(sale.leadId);
        if (!lead) {
            runLog.warnings.push({ message: `Lead ID ${sale.leadId} não encontrado para a venda ID ${sale.id}.` });
            continue;
        }

        const person = cache.mainPersonByLead.get(sale.leadId);
        if (!lead.organizationId || !person) {
            invalidDeals.push({ ...sale, lead, reason: `Associação Faltando: OrgID=${lead.organizationId}, PersonID=${person?.id}` });
            continue;
        }

        const primaryProductName = sale.products?.[0]?.name ?? 'Produto Principal';
        const dealName = `${lead.lead ?? `Lead ${lead.id}`} - ${primaryProductName}`;

        const baseDeal = {
            'Nome do negócio': dealName,
            'Pipeline': 'default',
            'Etapa do negócio': 'Vendido',
            'spotter_sale_id': sale.id,
            'spotter_organization_id': lead.organizationId,
            'spotter_person_id': person.id,
            'Data de fechamento': formatDateBR(sale.saleDate),
            'origem_comercial_real': mapOrigemComercialReal(lead.source?.value),
        };

        dealRows.push(baseDeal);

        if (exportLineItems) {
            if (sale.products && sale.products.length > 0) {
                for (const product of sale.products) {
                    lineItemRows.push({
                        ...baseDeal, // Associate with the deal
                        'Nome do item de linha': product.name,
                        'Quantidade': product.quantity ?? 1,
                        'Preço unitário': product.individualValue ?? 0,
                    });
                }
            } else {
                 runLog.warnings.push({ message: `Venda ID ${sale.id} não tem produtos para exportar como itens de linha.` });
            }
        }
    }

    await writeCsv(runId, 'deals', Object.keys(dealRows[0] || {}), dealRows, log);
    runLog.counts.exportedDeals = dealRows.length;
    if (invalidDeals.length > 0) {
        await writeCsv(runId, 'deals_invalid', Object.keys(invalidDeals[0] || {}), invalidDeals, log);
    }

    if (exportLineItems) {
        await writeCsv(runId, 'line-items', Object.keys(lineItemRows[0] || {}), lineItemRows, log);
        runLog.counts.exportedLineItems = lineItemRows.length;
    }
}
//endregion

//region Main Orchestrator
export async function exportDataForMode(
  mode: ExportMode,
  entities: ExportableEntity[],
  token: string,
  baseUrl: string,
  log: LogCallback
): Promise<{ exportId: string }> {
    const runId = uuidv4();
    const runLog: RunLog = {
        runId,
        mode,
        entities,
        startTime: new Date().toISOString(),
        counts: {},
        warnings: [],
        errors: [],
    };
    const cache: DataCache = {};

    try {
        log(`Execução ID: ${runId}`);
        if (mode === 'sold') { // Only sold mode is implemented with selection
            const wantsDeals = entities.includes('deals');
            const wantsLineItems = entities.includes('lineItems');

            if (entities.includes('companies')) {
                await exportCompanies(runId, cache, runLog, token, baseUrl, log);
            }
            if (entities.includes('contacts')) {
                await exportContacts(runId, cache, runLog, token, baseUrl, log);
            }
            if (wantsDeals || wantsLineItems) {
                await exportDealsAndLineItems(runId, cache, runLog, token, baseUrl, log, wantsLineItems);
            }
        } else {
            // Logic for 'open', 'lost' modes would go here, but they are not selectable yet.
            log(`Modo '${mode}' não suporta exportação seletiva ainda.`);
            throw new Error(`Modo '${mode}' não suporta exportação seletiva.`);
        }

        runLog.endTime = new Date().toISOString();
        await writeLogFile(runId, runLog);
        log('Exportação concluída com sucesso.');

        return { exportId: runId };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Ocorreu um erro desconhecido';
        runLog.errors.push({ message: errorMessage, details: error });
        runLog.endTime = newtoISOString();
        await writeLogFile(runId, runLog);
        log(`ERRO: ${errorMessage}`);
        throw error;
    }
}

async function writeCsv(runId: string, entityName: string, headers: string[], data: any[], log: LogCallback) {
    if (data.length === 0 || headers.length === 0) {
        log(`Nenhum dado para exportar para ${entityName}. Arquivo não será gerado.`);
        return;
    }
    const exportsDir = join(process.cwd(), 'exports');
    await mkdir(exportsDir, { recursive: true });
    const filePath = join(exportsDir, `${runId}_${entityName}.csv`);

    const rows = data.map(row => headers.map(header => sanitizeCsvValue(row[header])));
    const csvContent = buildCsv(headers, rows);

    await writeFile(filePath, csvContent, 'utf-8');
    log(`Arquivo ${entityName}.csv salvo com ${data.length} linhas.`);
}

async function writeLogFile(runId: string, logObject: RunLog): Promise<void> {
    const exportsDir = join(process.cwd(), 'exports');
    await mkdir(exportsDir, { recursive: true });
    const logFilePath = join(exportsDir, `${runId}_run.json`);
    await writeFile(logFilePath, JSON.stringify(logObject, null, 2), 'utf-8');
}
//endregion
