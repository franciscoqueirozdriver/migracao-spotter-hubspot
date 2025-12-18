// lib/exporter.ts
import { fetchAllSpotterOData, ODataResponse } from './spotter';
import { buildCsv, sanitizeCsvValue } from './csv';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

//region Type Definitions
export type LogCallback = (message: string) => void;
export type ExportMode = 'sold' | 'open' | 'lost' | 'custom';

// Spotter API Interfaces (can be expanded as needed for other modes)
export interface SpotterLeadSold {
  leadId: number;
  saleDate: string;
  saleStage?: string;
  cycle?: number;
  totalDealValue?: number;
  id: number;
  products?: {
    id: number;
    name?: string;
    quantity?: number;
    individualValue?: number;
    discountAmount?: number;
    discountType?: string;
    finalValue?: number;
  }[];
  salesRep?: { email?: string };
  preSales?: { email?: string };
}

export interface SpotterLead {
  id: number;
  lead?: string;
  website?: string;
  organizationId?: number;
  source?: { value?: string };
  stage?: { value?: string };
}

export interface SpotterPerson {
  id: number;
  name?: string;
  mainContact?: boolean;
  leadId?: number;
}

// HubSpot CSV Row Interface
export interface HubSpotDealLineItemRow {
    'Nome do negócio': string;
    'Pipeline': string;
    'Etapa do negócio': string;
    'spotter_sale_id'?: string; // Optional for non-sold modes
    'spotter_lead_id': string;
    'spotter_sale_date'?: string;
    'spotter_sale_stage'?: string;
    'spotter_cycle'?: string;
    'spotter_total_deal_value'?: string;
    'spotter_salesrep_email'?: string;
    'spotter_presales_email'?: string;
    'origem_comercial_real': string;
    'spotter_organization_id': string;
    'spotter_person_id': string;
    // Line item fields - optional for modes without products
    'Nome'?: string;
    'Quantidade'?: string;
    'Preço unitário'?: string;
    'spotter_product_id'?: string;
    'spotter_discount_amount'?: string;
    'spotter_discount_type'?: string;
    'spotter_final_value'?: string;
}

// Log object for run.json
interface RunLog {
  runId: string;
  mode: ExportMode;
  startTime: string;
  endTime?: string;
  filters: Record<string, any>;
  counts: {
    fetchedLeads?: number;
    fetchedLeadsSold?: number;
    fetchedPersons?: number;
    generatedRows?: number;
    invalidRows?: number;
  };
  warnings: { message: string; data?: unknown }[];
  errors: { message: string; details: unknown }[];
}
//endregion

//region Utility Functions
function formatDateBR(isoString?: string): string {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '';
        const day = String(date.getUTCDate()).padStart(2, '0');
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const year = date.getUTCFullYear();
        return `${day}/${month}/${year}`;
    } catch {
        return '';
    }
}

function mapOrigemComercialReal(sourceValue?: string): string {
    if (!sourceValue) return 'Inbound';
    const normalized = sourceValue.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    if (normalized.includes('prospeccao ativa') || normalized.includes('outbound')) return 'Outbound';
    if (normalized.includes('carteira de clientes') || normalized.includes('base') || normalized.includes('white space')) return 'White Space (Base)';
    if (normalized.includes('indicacao') || normalized.includes('programa')) return 'Base Viral (Programa de Indicação)';
    if (normalized.includes('parceiros') || normalized.includes('partner')) return 'Parceiros';

    return 'Inbound';
}
//endregion

//region Data Fetching
async function fetchAllLeads(token: string, baseUrl: string, log: LogCallback, filters?: string): Promise<Map<number, SpotterLead>> {
    const url = `${baseUrl}/v3/Leads${filters ? `?$filter=${filters}` : ''}`;
    const leads = await fetchAllSpotterOData<SpotterLead>(url, token, log);
    const map = new Map<number, SpotterLead>();
    for (const lead of leads) {
        map.set(lead.id, lead);
    }
    return map;
}

async function fetchAllLeadsSold(token: string, baseUrl: string, log: LogCallback): Promise<SpotterLeadSold[]> {
    return fetchAllSpotterOData<SpotterLeadSold>(`${baseUrl}/v3/LeadsSold`, token, log);
}

async function fetchAllPersons(token: string, baseUrl: string, log: LogCallback): Promise<Map<number, number | undefined>> {
    const persons = await fetchAllSpotterOData<SpotterPerson>(`${baseUrl}/v3/Persons/`, token, log);
    const personsByLead = new Map<number, SpotterPerson[]>();

    for (const person of persons) {
        if (person.leadId) {
            if (!personsByLead.has(person.leadId)) {
                personsByLead.set(person.leadId, []);
            }
            personsByLead.get(person.leadId)!.push(person);
        }
    }

    const mainPersonByLeadId = new Map<number, number | undefined>();
    personsByLead.forEach((personList, leadId) => {
        const mainContact = personList.find(p => p.mainContact === true);
        const primaryPerson = mainContact ?? personList[0];
        mainPersonByLeadId.set(leadId, primaryPerson?.id);
    });
    return mainPersonByLeadId;
}
//endregion

//region Core Logic for "sold" mode
async function processSoldMode(token: string, baseUrl: string, log: LogCallback, runLog: RunLog): Promise<{ validRows: HubSpotDealLineItemRow[], invalidRows: any[] }> {
    log('MODO SOLD: Iniciando exportação de vendas concluídas.');

    log('Carregando pessoas...');
    const mainPersonByLeadId = await fetchAllPersons(token, baseUrl, log);
    runLog.counts.fetchedPersons = mainPersonByLeadId.size;
    log(`Pessoas carregadas: ${mainPersonByLeadId.size}`);

    log('Carregando vendas (LeadsSold)...');
    const leadsSold = await fetchAllLeadsSold(token, baseUrl, log);
    runLog.counts.fetchedLeadsSold = leadsSold.length;
    log(`Vendas carregadas: ${leadsSold.length}`);

    const allLeadIds = leadsSold.map(s => s.leadId);
    const uniqueLeadIds = Array.from(new Set(allLeadIds));
    // This part is inefficient if there are many leads. A better approach would be to fetch leads as needed.
    // For now, keeping it simple to match the original logic.
    log('Carregando todos os leads para buscar detalhes...');
    const allLeads = await fetchAllLeads(token, baseUrl, log); // No filter, gets all leads
    runLog.counts.fetchedLeads = allLeads.size;
    log(`Total de leads carregados no sistema: ${allLeads.size}`);


    const validRows: HubSpotDealLineItemRow[] = [];
    const invalidRows: any[] = [];

    for (const sale of leadsSold) {
        const lead = allLeads.get(sale.leadId);
        if (!lead) {
            runLog.warnings.push({ message: `Lead com ID ${sale.leadId} não encontrado. Venda ${sale.id} será pulada.`, data: sale });
            invalidRows.push({ ...sale, reason: `Lead com ID ${sale.leadId} não encontrado` });
            continue;
        }

        const products = sale.products ?? [];
        if (products.length === 0) {
            runLog.warnings.push({ message: `Venda ${sale.id} não possui produtos. Será tratada como negócio sem line items.`, data: sale });
        }

        const spotter_organization_id = lead.organizationId;
        const spotter_person_id = mainPersonByLeadId.get(sale.leadId);

        if (!spotter_organization_id || !spotter_person_id) {
            invalidRows.push({ ...sale, lead, reason: `Associação obrigatória ausente: organizationId=${spotter_organization_id}, personId=${spotter_person_id}` });
            continue;
        }

        const primaryProduct = products[0];
        const primaryProductName = primaryProduct?.name ?? `Produto Desconhecido`;
        const dealName = `${lead.lead ?? `Lead ${lead.id}`} - ${primaryProductName}`;

        if (products.length > 0) {
            for (const product of products) {
                validRows.push({
                    'Nome do negócio': dealName,
                    'Pipeline': 'default',
                    'Etapa do negócio': 'Vendido',
                    'spotter_sale_id': String(sale.id),
                    'spotter_lead_id': String(sale.leadId),
                    'spotter_sale_date': formatDateBR(sale.saleDate),
                    'spotter_organization_id': String(spotter_organization_id),
                    'spotter_person_id': String(spotter_person_id),
                    'origem_comercial_real': mapOrigemComercialReal(lead.source?.value),
                    'Nome': product.name,
                    'Quantidade': String(product.quantity ?? 1),
                    'Preço unitário': String(product.individualValue ?? 0),
                });
            }
        } else { // Handle deals with no line items
             validRows.push({
                'Nome do negócio': dealName,
                'Pipeline': 'default',
                'Etapa do negócio': 'Vendido',
                'spotter_sale_id': String(sale.id),
                'spotter_lead_id': String(sale.leadId),
                'spotter_sale_date': formatDateBR(sale.saleDate),
                'spotter_organization_id': String(spotter_organization_id),
                'spotter_person_id': String(spotter_person_id),
                'origem_comercial_real': mapOrigemComercialReal(lead.source?.value),
            });
        }
    }

    return { validRows, invalidRows };
}
//endregion

//region Core Logic for "open" and "lost" modes
async function processLeadsMode(mode: 'open' | 'lost', token: string, baseUrl: string, log: LogCallback, runLog: RunLog): Promise<{ validRows: HubSpotDealLineItemRow[], invalidRows: any[] }> {
    log(`MODO ${mode.toUpperCase()}: Iniciando exportação.`);

    let filter: string;
    let etapaNegocio: string;
    if (mode === 'open') {
        filter = "stage/value ne 'Vendido' and stage/value ne 'Perdido'";
        etapaNegocio = 'Em andamento'; // This should be mapped to a real stage later
    } else { // lost
        filter = "stage/value eq 'Perdido'";
        etapaNegocio = 'Perdido';
    }
    runLog.filters = { odata: filter };

    log('Carregando pessoas...');
    const mainPersonByLeadId = await fetchAllPersons(token, baseUrl, log);
    runLog.counts.fetchedPersons = mainPersonByLeadId.size;
    log(`Pessoas carregadas: ${mainPersonByLeadId.size}`);

    log(`Carregando leads com filtro: ${filter}...`);
    const leads = await fetchAllLeads(token, baseUrl, log, filter);
    runLog.counts.fetchedLeads = leads.size;
    log(`Leads carregados: ${leads.size}`);

    const validRows: HubSpotDealLineItemRow[] = [];
    const invalidRows: any[] = [];

    leads.forEach(lead => {
        const spotter_organization_id = lead.organizationId;
        const spotter_person_id = mainPersonByLeadId.get(lead.id);

        if (!spotter_organization_id || !spotter_person_id) {
            invalidRows.push({ ...lead, reason: `Associação obrigatória ausente: organizationId=${spotter_organization_id}, personId=${spotter_person_id}` });
            return; // continue to next iteration
        }

        validRows.push({
            'Nome do negócio': `${lead.lead ?? `Lead ${lead.id}`} - Pipeline`,
            'Pipeline': 'default',
            'Etapa do negócio': etapaNegocio,
            'spotter_lead_id': String(lead.id),
            'spotter_organization_id': String(spotter_organization_id),
            'spotter_person_id': String(spotter_person_id),
            'origem_comercial_real': mapOrigemComercialReal(lead.source?.value),
        });
    });

    return { validRows, invalidRows };
}
//endregion


//region Main Export Orchestrator
export async function exportDataForMode(
  mode: ExportMode,
  token: string,
  baseUrl: string,
  log: LogCallback
): Promise<{ exportId: string, csvContent: string }> {
    const runId = uuidv4();
    const runLog: RunLog = {
        runId,
        mode,
        startTime: new Date().toISOString(),
        filters: {},
        counts: {},
        warnings: [],
        errors: [],
    };

    try {
        let result: { validRows: any[], invalidRows: any[] };

        switch (mode) {
            case 'sold':
                result = await processSoldMode(token, baseUrl, log, runLog);
                break;
            case 'open':
            case 'lost':
                result = await processLeadsMode(mode, token, baseUrl, log, runLog);
                break;
            case 'custom':
                throw new Error('Modo "custom" ainda não implementado.');
            default:
                throw new Error(`Modo de exportação desconhecido: ${mode}`);
        }

        const { validRows, invalidRows } = result;

        runLog.counts.generatedRows = validRows.length;
        runLog.counts.invalidRows = invalidRows.length;
        log(`Processamento concluído. Linhas válidas: ${validRows.length}, Linhas inválidas: ${invalidRows.length}`);

        let csvContent = '';
        if (validRows.length > 0) {
            const headers = Object.keys(validRows[0]);
            const csvRows = validRows.map(row => headers.map(header => sanitizeCsvValue(row[header])));
            csvContent = buildCsv(headers, csvRows);
            log(`CSV principal gerado com ${validRows.length} linhas.`);
        } else {
            log('Nenhuma linha válida gerada. O CSV principal estará vazio.');
        }

        if (invalidRows.length > 0) {
            const invalidCsvPath = await writeInvalidCsv(runId, invalidRows);
            log(`CSV de inválidos salvo em: ${invalidCsvPath}`);
        }

        runLog.endTime = new Date().toISOString();
        await writeLogFile(runId, runLog);
        log(`Log de execução salvo para o ID: ${runId}`);

        return { exportId: runId, csvContent };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Ocorreu um erro desconhecido';
        runLog.errors.push({ message: errorMessage, details: error });
        runLog.endTime = new Date().toISOString();
        await writeLogFile(runId, runLog);
        log(`ERRO: ${errorMessage}`);
        throw error;
    }
}

async function writeLogFile(runId: string, logObject: RunLog): Promise<void> {
    const exportsDir = join(process.cwd(), 'exports');
    await mkdir(exportsDir, { recursive: true });
    const logFilePath = join(exportsDir, `${runId}_run.json`);
    try {
        await writeFile(logFilePath, JSON.stringify(logObject, null, 2), 'utf-8');
    } catch (error) {
        console.error('Falha ao escrever arquivo de log:', error);
    }
}

async function writeInvalidCsv(runId: string, invalidRows: any[]): Promise<string> {
    const exportsDir = join(process.cwd(), 'exports');
    await mkdir(exportsDir, { recursive: true });
    const filePath = join(exportsDir, `${runId}_invalid.csv`);

    if (invalidRows.length === 0) return filePath;

    // Normalize headers based on all possible keys in invalid rows
    const headers = Array.from(new Set(invalidRows.flatMap(row => Object.keys(row))));
    const csvRows = invalidRows.map(row => headers.map(header => sanitizeCsvValue(row[header])));

    const csvContent = buildCsv(headers, csvRows);
    await writeFile(filePath, csvContent, 'utf-8');
    return filePath;
}
//endregion
