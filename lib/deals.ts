// lib/deals.ts
import { buildCsv, sanitizeCsvValue } from './csv';
import { writeFile } from 'fs/promises';
import { join } from 'path';

//region Constants & Configuration
const HUBSPOT_PIPELINE = process.env.HUBSPOT_DEALS_PIPELINE_LABEL || 'default';
const HUBSPOT_DEAL_STAGE_SOLD = 'Vendido'; // Fixed value as per new requirement

const RETRY_CONFIG = {
  attempts: 6,
  initialDelay: 500, // ms
  maxDelay: 10000, // ms
};
//endregion

//region Type Definitions
export type LogCallback = (message: string) => void;

export type ODataResponse<T> = {
  value?: T[];
  ['@odata.nextLink']?: string;
};

// Spotter API Interfaces
export interface SpotterSoldProduct {
  id: number;
  quantity?: number;
  individualValue?: number;
  discountAmount?: number;
  discountType?: string;
  finalValue?: number;
  name?: string;
  fullValue?: number;
}

export interface SpotterSale {
  leadId: number;
  saleDate: string;
  id: number; // Sale ID
  products?: SpotterSoldProduct[];
  // Other fields are kept for type safety but not used in the new logic
  saleStage?: string;
  cycle?: number;
  totalDealValue?: number;
  salesRep?: { email?: string };
  preSales?: { email?: string };
}

export interface SpotterLead {
  id: number;
  lead?: string;
  website?: string;
  source?: { value?: string };
}

// Simplified index type
export interface LeadIndex {
  leadName: string;
  companyDomain: string;
  contactEmail: string; // Will be empty as per requirements
  origem: string;
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
  'contact_email': string;
  'company_domain': string;
  'Nome': string; // Line Item Name
  'Quantidade': string;
  'Preço unitário': string;
  'spotter_product_id': string;
  'spotter_individual_value': string;
  'spotter_discount_amount': string;
  'spotter_discount_type': string;
  'spotter_final_value': string;
}

// Log object for the JSON file
type LogObject = {
  totalLeadsFetched: number;
  totalSalesFetched: number;
  totalRowsGenerated: number;
  warnings: { message: string; data: unknown }[];
  errors: { message: string; details: unknown }[];
  csvSample: HubSpotDealLineItemRow[];
};
//endregion

//region Utility Functions
async function resilientFetch(url: string, options: RequestInit, log: LogCallback): Promise<Response> {
  let lastError: Error | undefined;

  for (let i = 0; i < RETRY_CONFIG.attempts; i++) {
    const delay = Math.min(RETRY_CONFIG.maxDelay, RETRY_CONFIG.initialDelay * Math.pow(2, i));
    const jitter = delay * 0.2 * Math.random();
    const waitTime = delay + jitter;

    try {
      const response = await fetch(url, options);
      if (response.status === 503 || response.status >= 500) {
        throw new Error(`Spotter API returned a server error: ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      log(`Attempt ${i + 1}/${RETRY_CONFIG.attempts} failed: ${lastError.message}. Retrying in ${Math.round(waitTime)}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw new Error(`Failed to fetch from Spotter API after ${RETRY_CONFIG.attempts} attempts. Last error: ${lastError?.message}`);
}

async function fetchAllSpotterDataWithRetries<T>(initialUrl: string, token: string, log: LogCallback): Promise<T[]> {
  let allItems: T[] = [];
  let nextUrl: string | undefined = initialUrl;
  let page = 1;

  while (nextUrl) {
    log(`Fetching page ${page} from ${nextUrl.split('?')[0]}...`);
    const response = await resilientFetch(nextUrl, { headers: { 'token_exact': token } }, log);
    const data: ODataResponse<T> = await response.json();
    const items = data.value ?? [];

    if (items.length === 0) {
      log('Received an empty page. Finalizing fetch.');
      break;
    }

    allItems = allItems.concat(items);
    log(`Fetched ${items.length} items from page ${page}. Total so far: ${allItems.length}.`);
    nextUrl = data['@odata.nextLink'];
    page++;
  }
  return allItems;
}

function formatDateBR(isoString: string | null | undefined): string {
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
//endregion

//region Data Fetching and Processing
async function fetchAndBuildLeadIndex(token: string, baseUrl: string, log: LogCallback): Promise<Map<number, LeadIndex>> {
  log('Carregando leads para índice...');
  const leads = await fetchAllSpotterDataWithRetries<SpotterLead>(`${baseUrl}/v3/Leads`, token, log);
  log(`Leads carregados: ${leads.length}`);
  log('Aviso: contact_email não disponível via /Leads; coluna gerada vazia.');

  const leadIndexMap = new Map<number, LeadIndex>();
  for (const lead of leads) {
    let companyDomain = '';
    if (lead.website) {
      try {
        const url = new URL(lead.website);
        companyDomain = url.hostname.replace(/^www\./, '');
      } catch {
        // Handle invalid URLs gracefully
        companyDomain = lead.website.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
      }
    }

    leadIndexMap.set(lead.id, {
      leadName: lead.lead ?? '',
      companyDomain,
      contactEmail: '', // As per requirement, this is empty for now
      origem: lead.source?.value ?? '',
    });
  }
  return leadIndexMap;
}

async function fetchAllLeadsSold(token: string, baseUrl: string, log: LogCallback): Promise<SpotterSale[]> {
    log('Carregando vendas (LeadsSold)...');
    const sales = await fetchAllSpotterDataWithRetries<SpotterSale>(`${baseUrl}/v3/LeadsSold`, token, log);
    log(`Vendas carregadas: ${sales.length}`);
    return sales;
}

function normalizeDiscountType(type: string | null | undefined): string {
    if (!type) return 'Nenhum';
    const lowerType = type.toLowerCase();
    if (lowerType.includes('absoluto')) return 'Absoluto';
    if (lowerType.includes('percentual')) return 'Porcentual';
    return type; // Return original if not recognized
}

function buildDealsAndLineItemsRows(
  leadsSold: SpotterSale[],
  leadIndexMap: Map<number, LeadIndex>,
  logObject: LogObject
): HubSpotDealLineItemRow[] {
  const rows: HubSpotDealLineItemRow[] = [];

  for (const sale of leadsSold) {
    const products = sale.products ?? [];
    if (products.length === 0) {
      logObject.warnings.push({
        message: `Sale ID ${sale.id} has no products and will be skipped.`,
        data: { saleId: sale.id, leadId: sale.leadId },
      });
      continue;
    }

    const leadInfo = leadIndexMap.get(sale.leadId);
    const primaryProduct = products[0];
    const primaryProductName = primaryProduct?.name ?? `Produto ${primaryProduct.id}`;
    const leadName = leadInfo?.leadName || `Lead ${sale.leadId}`;
    const dealName = `${leadName} - ${primaryProductName}`;

    const dealData = {
      'Nome do negócio': dealName, // Use the same dealName for all line items
      'Pipeline': HUBSPOT_PIPELINE,
      'Etapa do negócio': HUBSPOT_DEAL_STAGE_SOLD,
      'spotter_sale_id': String(sale.id),
      'spotter_lead_id': String(sale.leadId),
      'spotter_sale_date': formatDateBR(sale.saleDate),
      'spotter_sale_stage': sale.saleStage ?? '',
      'spotter_cycle': String(sale.cycle ?? ''),
      'spotter_total_deal_value': String(sale.totalDealValue ?? 0),
      'spotter_salesrep_email': sale.salesRep?.email ?? '',
      'spotter_presales_email': sale.preSales?.email ?? '',
      'origem_comercial_real': leadInfo?.origem ?? '',
      'contact_email': leadInfo?.contactEmail ?? '',
      'company_domain': leadInfo?.companyDomain ?? '',
    };

    for (const product of products) {
      const name = product.name?.replace(/[\r\n]/g, ' ') ?? 'Produto sem nome';
      const quantityNum = Number(product.quantity ?? 1);
      const quantity = Number.isFinite(quantityNum) && quantityNum > 0 ? quantityNum : 1;
      const unitPrice = product.individualValue ?? product.fullValue ?? 0;

      if (!name || name === 'Produto sem nome') {
        logObject.warnings.push({
          message: `Product in Sale ID ${sale.id} has no name.`,
          data: { saleId: sale.id, productId: product.id },
        });
      }

      const row: HubSpotDealLineItemRow = {
        ...dealData,
        'Nome': name,
        'Quantidade': String(quantity),
        'Preço unitário': String(unitPrice),
        'spotter_product_id': String(product.id),
        'spotter_individual_value': String(product.individualValue ?? 0),
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
  log('Iniciando exportação...');
  const logObject: LogObject = {
    totalLeadsFetched: 0,
    totalSalesFetched: 0,
    totalRowsGenerated: 0,
    warnings: [],
    errors: [],
    csvSample: [],
  };

  try {
    const leadIndexMap = await fetchAndBuildLeadIndex(token, baseUrl, log);
    logObject.totalLeadsFetched = leadIndexMap.size;

    const leadsSold = await fetchAllLeadsSold(token, baseUrl, log);
    logObject.totalSalesFetched = leadsSold.length;

    log('Gerando CSV...');
    const rows = buildDealsAndLineItemsRows(leadsSold, leadIndexMap, logObject);
    logObject.totalRowsGenerated = rows.length;
    log(`CSV gerado com ${rows.length} linhas.`);

    if (rows.length === 0) {
      log('No valid rows were generated. The CSV will be empty.');
      await writeLogFile(logObject);
      return { csvContent: '' };
    }

    log('Generating CSV content...');
    logObject.csvSample = rows.slice(0, 3);
    const headers = Object.keys(rows[0]) as (keyof HubSpotDealLineItemRow)[];
    const csvRows = rows.map(row => headers.map(header => sanitizeCsvValue(row[header])));

    const csvContent = buildCsv(headers, csvRows);
    log(`CSV generation complete. Total warnings: ${logObject.warnings.length}.`);

    await writeLogFile(logObject);
    return { csvContent };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    log(`FATAL ERROR: ${errorMessage}`);
    logObject.errors.push({ message: errorMessage, details: error });
    await writeLogFile(logObject);
    throw error;
  }
}

async function writeLogFile(logObject: LogObject): Promise<void> {
  const exportsDir = join(process.cwd(), 'exports');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFilePath = join(exportsDir, `spotter_to_hubspot_deals_line_items_${timestamp}.log.json`);
  try {
    await writeFile(logFilePath, JSON.stringify(logObject, null, 2), 'utf-8');
    console.log(`Log file saved to ${logFilePath}`);
  } catch (error) {
    console.error('Failed to write log file:', error);
  }
}
//endregion
