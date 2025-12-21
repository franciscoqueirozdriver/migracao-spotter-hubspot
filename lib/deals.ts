// lib/deals.ts
import { fetchAllSpotterOData } from './spotter';
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
  stage?: { name?: string };
  pipeline?: string;
  value?: number;
  registerDate?: string;
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
  'spotter_sale_id': string;
  'spotter_lead_id': string;
  'spotter_sale_date': string; // Used for Create Date as well in total mode
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
  totalPersonsFetched: number;
  totalSalesFetched: number;
  totalRowsGenerated: number;
  warnings: { message: string; data?: unknown }[];
  errors: { message: string; details: unknown }[];
  csvSample: Record<string, string>[];
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

// Helper to write logs
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

//region Data Fetching Functions
async function fetchAllLeadsSold(token: string, baseUrl: string, log: LogCallback): Promise<SpotterLeadSold[]> {
  return fetchAllSpotterOData<SpotterLeadSold>(`${baseUrl}/v3/LeadsSold`, token, log);
}

async function fetchAllLeads(token: string, baseUrl: string, log: LogCallback): Promise<SpotterLead[]> {
    return fetchAllSpotterOData<SpotterLead>(`${baseUrl}/v3/Leads`, token, log);
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

//region CSV Generation Logic for SOLD Leads
function buildDefaultRows(
  leadsSold: SpotterLeadSold[],
  leadsById: Map<number, SpotterLead>,
  mainPersonByLeadId: Map<number, number | undefined>,
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

    const spotter_person_id = mainPersonByLeadId.get(sale.leadId) ?? '';
    if (!spotter_person_id) {
        logObject.warnings.push({ message: `Lead ${lead.id} não possui contato primário.`, data: lead });
    }

    let origem = mapOrigemComercialReal(lead.source?.value);
    if (origem === 'Inbound' && lead.source?.value) {
        logObject.warnings.push({ message: `Origem "${lead.source.value}" mapeada para Inbound (default).`, data: lead });
    }

    const primaryProduct = products[0];
    const primaryProductName = primaryProduct?.name ?? `Produto ${primaryProduct.id}`;
    const dealName = `${lead.lead ?? '(sem nome)'} - ${primaryProductName}`;

    for (const product of products) {
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

function buildHubSpotTemplateRows(
  leadsSold: SpotterLeadSold[],
  leadsById: Map<number, SpotterLead>,
  mainPersonByLeadId: Map<number, number | undefined>,
  logObject: LogObject
): Record<string, string>[] {
  // Logic identical to default rows, but with HubSpot-specific headers
  const rows: Record<string, string>[] = [];

  // Re-implementing essentially the same loop to support different header keys
  // This duplication was in the original file, maintaining for safety
  for (const sale of leadsSold) {
    const lead = leadsById.get(sale.leadId);
    if (!lead) { continue; }
    const products = sale.products ?? [];
    if (products.length === 0) { continue; }

    const spotter_organization_id = lead.organizationId ?? '';
    const spotter_person_id = mainPersonByLeadId.get(sale.leadId) ?? '';
    let origem = mapOrigemComercialReal(lead.source?.value);

    const primaryProduct = products[0];
    const primaryProductName = primaryProduct?.name ?? `Produto ${primaryProduct.id}`;
    const dealName = `${lead.lead ?? '(sem nome)'} - ${primaryProductName}`;

    for (const product of products) {
      const row: Record<string, string> = {
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
        'Nome <LINE_ITEM name>': product.name ?? '',
        'Quantidade <LINE_ITEM quantity>': String(product.quantity ?? 1),
        'Preço unitário <LINE_ITEM price>': String(product.individualValue ?? 0),
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

//region CSV Generation for ALL Leads (Total Mode)
function buildAllLeadsRows(
  allLeads: SpotterLead[],
  mainPersonByLeadId: Map<number, number | undefined>,
  logObject: LogObject
): HubSpotDealLineItemRow[] {
    const rows: HubSpotDealLineItemRow[] = [];

    for (const lead of allLeads) {
        // Map Lead to Deal
        const dealName = lead.lead ?? `Lead ${lead.id}`;
        const spotter_organization_id = lead.organizationId ?? '';
        const spotter_person_id = mainPersonByLeadId.get(lead.id) ?? '';
        const origem = mapOrigemComercialReal(lead.source?.value);

        // Since we don't have product details for open/lost leads typically, we create a Deal-only row.
        // Or we use dummy product data if HubSpot requires it for the import format "Deals + Line Items".
        // However, standard HubSpot Deal import can ignore line item columns if they are empty.

        const row: HubSpotDealLineItemRow = {
            'Nome do negócio': dealName,
            'Pipeline': lead.pipeline ?? 'default',
            'Etapa do negócio': lead.stage?.name ?? 'Sem Etapa',
            'spotter_sale_id': '', // No sale ID for non-sold leads, could use lead ID or empty
            'spotter_lead_id': String(lead.id),
            'spotter_sale_date': formatDateBR(lead.registerDate), // Using register date as proxy for creation
            'spotter_sale_stage': '',
            'spotter_cycle': '',
            'spotter_total_deal_value': String(lead.value ?? 0),
            'spotter_salesrep_email': '',
            'spotter_presales_email': '',
            'origem_comercial_real': origem,
            'spotter_organization_id': String(spotter_organization_id),
            'spotter_person_id': String(spotter_person_id),
            'Nome': '', // No Line Item Name
            'Quantidade': '',
            'Preço unitário': '',
            'spotter_product_id': '',
            'spotter_discount_amount': '',
            'spotter_discount_type': '',
            'spotter_final_value': ''
        };
        rows.push(row);
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
    totalPersonsFetched: 0,
    totalSalesFetched: 0,
    totalRowsGenerated: 0,
    warnings: [],
    errors: [],
    csvSample: [],
  };

  try {
    log('Carregando leads...');
    const allLeads = await fetchAllLeads(token, baseUrl, log);
    const leadsById = new Map<number, SpotterLead>();
    for (const l of allLeads) leadsById.set(l.id, l);

    logObject.totalLeadsFetched = allLeads.length;
    log(`Leads carregados: ${allLeads.length}`);

    log('Carregando pessoas...');
    const mainPersonByLeadId = await fetchAllPersons(token, baseUrl, log);
    logObject.totalPersonsFetched = mainPersonByLeadId.size;
    log(`Pessoas carregadas: ${mainPersonByLeadId.size}`);

    log('Carregando vendas...');
    const leadsSold = await fetchAllLeadsSold(token, baseUrl, log);
    logObject.totalSalesFetched = leadsSold.length;
    log(`Vendas carregadas: ${leadsSold.length}`);

    log('Gerando CSV...');
    const useHubSpotHeaders = process.env.HUBSPOT_TEMPLATE_HEADERS === 'true';
    const rows = useHubSpotHeaders
      ? buildHubSpotTemplateRows(leadsSold, leadsById, mainPersonByLeadId, logObject)
      : buildDefaultRows(leadsSold, leadsById, mainPersonByLeadId, logObject);
    logObject.totalRowsGenerated = rows.length;
    log(`CSV gerado com ${rows.length} linhas.`);

    if (rows.length === 0) {
      log('Nenhuma linha válida gerada. O CSV estará vazio.');
      await writeLogFile(logObject);
      return { csvContent: '' };
    }

    logObject.csvSample = rows.slice(0, 3) as any[];
    const headers = Object.keys(rows[0]);
    const csvRows = rows.map(row => headers.map(header => sanitizeCsvValue((row as Record<string,string>)[header])));

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

// NEW FUNCTION FOR TOTAL EXPORT
export async function exportAllDealsToCsv(
    token: string,
    baseUrl: string,
    log: LogCallback
): Promise<{ csvContent: string }> {
    const logObject: LogObject = {
        totalLeadsFetched: 0,
        totalPersonsFetched: 0,
        totalSalesFetched: 0,
        totalRowsGenerated: 0,
        warnings: [],
        errors: [],
        csvSample: [],
      };

      try {
        log('Carregando TODOS os leads (não apenas vendidos)...');
        const allLeads = await fetchAllLeads(token, baseUrl, log);
        logObject.totalLeadsFetched = allLeads.length;
        log(`Total de leads carregados: ${allLeads.length}`);

        log('Carregando pessoas para referência cruzada...');
        const mainPersonByLeadId = await fetchAllPersons(token, baseUrl, log);
        logObject.totalPersonsFetched = mainPersonByLeadId.size;

        log('Gerando CSV de Negócios (Total)...');
        // We use the "All Leads" builder
        const rows = buildAllLeadsRows(allLeads, mainPersonByLeadId, logObject);
        logObject.totalRowsGenerated = rows.length;
        log(`CSV gerado com ${rows.length} linhas de negócio.`);

        if (rows.length === 0) {
            log('Nenhuma linha gerada.');
            return { csvContent: '' };
        }

        logObject.csvSample = rows.slice(0, 3) as any[];
        const headers = Object.keys(rows[0]);
        // Fix for Type error: Unsafe cast to Record<string, string>
        // We need to ensure TypeScript knows we are accessing string properties, or just cast to any for this generic CSV serializer
        const csvRows = rows.map(row => headers.map(header => {
            const val = (row as any)[header];
            return sanitizeCsvValue(val);
        }));

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
//endregion
