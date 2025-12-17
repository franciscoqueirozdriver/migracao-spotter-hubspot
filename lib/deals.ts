// lib/deals.ts
import { fetchAllSpotterOData, ODataResponse } from './spotter';
import { buildCsv, sanitizeCsvValue } from './csv';
import { writeFile } from 'fs/promises';
import { join } from 'path';

//region Type Definitions
export type LogCallback = (message: string) => void;

// Spotter API Interfaces
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
}

export interface SpotterLeadsAndPersons {
  id: number; // leadId
  persons?: {
    id: number;
    email?: string;
    mainContact?: boolean;
  }[];
}

// HubSpot CSV Row Interface
export interface HubSpotDealLineItemRow {
  'Nome do negócio': string;
  'Pipeline': string;
  'Etapa do negócio': string;
  'spotter_sale_id': string;
  'spotter_lead_id': string;
  'spotter_sale_date': string;
  'spotter_sale_stage': string;
  'spotter_cycle': string;
  'spotter_total_deal_value': string;
  'spotter_salesrep_email': string;
  'spotter_presales_email': string;
  'origem_comercial_real': string;
  'spotter_organization_id': string;
  'spotter_person_id': string;
  'Nome': string; // Line Item Name
  'Quantidade': string;
  'Preço unitário': string;
  'spotter_product_id': string;
  'spotter_discount_amount': string;
  'spotter_discount_type': string;
  'spotter_final_value': string;
}

// Log object
type LogObject = {
  totalLeadsFetched: number;
  totalLeadsAndPersonsFetched: number;
  totalSalesFetched: number;
  totalRowsGenerated: number;
  warnings: { message: string; data?: unknown }[];
  errors: { message: string; details: unknown }[];
  csvSample: HubSpotDealLineItemRow[];
};
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

  // Log warning for default case in the calling function
  return 'Inbound';
}

function normalizeDiscountType(type?: string): string {
    if (!type) return 'Nenhum';
    const lowerType = type.toLowerCase();
    if (lowerType.includes('absoluto')) return 'Absoluto';
    if (lowerType.includes('percentual')) return 'Porcentual';
    return type;
}
//endregion

//region Data Fetching Functions
async function fetchAllLeadsSold(token: string, baseUrl: string, log: LogCallback): Promise<SpotterLeadSold[]> {
  return fetchAllSpotterOData<SpotterLeadSold>(`${baseUrl}/v3/LeadsSold`, token, log);
}

async function fetchAllLeads(token: string, baseUrl: string, log: LogCallback): Promise<Map<number, SpotterLead>> {
  const leads = await fetchAllSpotterOData<SpotterLead>(`${baseUrl}/v3/Leads`, token, log);
  const map = new Map<number, SpotterLead>();
  for (const lead of leads) {
    map.set(lead.id, lead);
  }
  return map;
}

async function fetchAllLeadsAndPersons(token: string, baseUrl: string, log: LogCallback): Promise<Map<number, number | undefined>> {
  const leadsAndPersons = await fetchAllSpotterOData<SpotterLeadsAndPersons>(`${baseUrl}/v3/LeadsAndPersons`, token, log);
  const map = new Map<number, number | undefined>();
  for (const item of leadsAndPersons) {
    const persons = item.persons ?? [];
    const mainContact = persons.find(p => p.mainContact === true);
    const primaryPerson = mainContact ?? persons[0];
    map.set(item.id, primaryPerson?.id);
  }
  return map;
}
//endregion

//region CSV Generation Logic
function buildDealsAndLineItemsRows(
  leadsSold: SpotterLeadSold[],
  leadsById: Map<number, SpotterLead>,
  primaryPersonIdByLead: Map<number, number | undefined>,
  logObject: LogObject
): HubSpotDealLineItemRow[] {
  const rows: HubSpotDealLineItemRow[] = [];

  for (const sale of leadsSold) {
    const lead = leadsById.get(sale.leadId);
    if (!lead) {
      logObject.warnings.push({ message: `Lead com ID ${sale.leadId} não encontrado. Venda ${sale.id} será pulada.`, data: sale });
      continue;
    }

    const products = sale.products ?? [];
    if (products.length === 0) {
      logObject.warnings.push({ message: `Venda ${sale.id} não possui produtos e será pulada.`, data: sale });
      continue;
    }

    const spotter_organization_id = lead.organizationId ?? '';
    if (!spotter_organization_id) {
        logObject.warnings.push({ message: `Lead ${lead.id} não possui organizationId.`, data: lead });
    }

    const spotter_person_id = primaryPersonIdByLead.get(sale.leadId) ?? '';
     if (!spotter_person_id) {
        logObject.warnings.push({ message: `Lead ${lead.id} não possui contato primário.`, data: lead });
    }

    let origem = mapOrigemComercialReal(lead.source?.value);
    if (origem === 'Inbound' && lead.source?.value) {
        logObject.warnings.push({ message: `Origem "${lead.source.value}" mapeada para Inbound (default).`, data: lead });
    }

    for (const product of products) {
      const dealName = `${lead.lead ?? '(sem nome)'} - ${product.name ?? '(sem produto)'}`;

      const row: HubSpotDealLineItemRow = {
        'Nome do negócio': dealName,
        'Pipeline': 'default',
        'Etapa do negócio': 'Vendido',
        'spotter_sale_id': String(sale.id),
        'spotter_lead_id': String(sale.leadId),
        'spotter_sale_date': formatDateBR(sale.saleDate),
        'spotter_sale_stage': sale.saleStage ?? '',
        'spotter_cycle': String(sale.cycle ?? ''),
        'spotter_total_deal_value': String(sale.totalDealValue ?? 0),
        'spotter_salesrep_email': sale.salesRep?.email ?? '',
        'spotter_presales_email': sale.preSales?.email ?? '',
        'origem_comercial_real': origem,
        'spotter_organization_id': String(spotter_organization_id),
        'spotter_person_id': String(spotter_person_id),
        'Nome': product.name ?? '',
        'Quantidade': String(product.quantity ?? 1),
        'Preço unitário': String(product.individualValue ?? 0),
        'spotter_product_id': String(product.id),
        'spotter_discount_amount': String(product.discountAmount ?? 0),
        'spotter_discount_type': normalizeDiscountType(product.discountType),
        'spotter_final_value': String(product.finalValue ?? 0),
      };
      rows.push(row);
    }
  }
  return rows;
}
//endregion

//region Main Export Orchestrator
export async function exportDealsAndLineItemsToCsv(
  token: string,
  baseUrl: string,
  log: LogCallback
): Promise<{ csvContent: string }> {
  const logObject: LogObject = {
    totalLeadsFetched: 0,
    totalLeadsAndPersonsFetched: 0,
    totalSalesFetched: 0,
    totalRowsGenerated: 0,
    warnings: [],
    errors: [],
    csvSample: [],
  };

  try {
    log('Carregando leads...');
    const leadsById = await fetchAllLeads(token, baseUrl, log);
    logObject.totalLeadsFetched = leadsById.size;
    log(`Leads carregados: ${leadsById.size}`);

    log('Carregando leads e pessoas...');
    const primaryPersonIdByLead = await fetchAllLeadsAndPersons(token, baseUrl, log);
    logObject.totalLeadsAndPersonsFetched = primaryPersonIdByLead.size;
    log(`Leads e pessoas carregados: ${primaryPersonIdByLead.size}`);

    log('Carregando vendas...');
    const leadsSold = await fetchAllLeadsSold(token, baseUrl, log);
    logObject.totalSalesFetched = leadsSold.length;
    log(`Vendas carregadas: ${leadsSold.length}`);

    log('Gerando CSV...');
    const rows = buildDealsAndLineItemsRows(leadsSold, leadsById, primaryPersonIdByLead, logObject);
    logObject.totalRowsGenerated = rows.length;
    log(`CSV gerado com ${rows.length} linhas.`);

    if (rows.length === 0) {
      log('Nenhuma linha válida gerada. O CSV estará vazio.');
      await writeLogFile(logObject);
      return { csvContent: '' };
    }

    logObject.csvSample = rows.slice(0, 3);
    const headers = Object.keys(rows[0]) as (keyof HubSpotDealLineItemRow)[];
    const csvRows = rows.map(row => headers.map(header => sanitizeCsvValue(row[header])));

    const csvContent = buildCsv(headers, csvRows);

    await writeLogFile(logObject);
    return { csvContent };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    logObject.errors.push({ message: errorMessage, details: error });
    await writeLogFile(logObject);
    throw error;
  }
}

async function writeLogFile(logObject: LogObject): Promise<void> {
  const exportsDir = join(process.cwd(), 'exports');
  const logFilePath = join(exportsDir, 'spotter_to_hubspot_deals_line_items.log.json');
  try {
    await writeFile(logFilePath, JSON.stringify(logObject, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to write log file:', error);
  }
}
//endregion
