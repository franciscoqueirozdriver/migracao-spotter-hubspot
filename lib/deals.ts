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
  lead?: string; // This is the lead name
  organizationId?: number | null;
  source?: { value?: string };
}

export interface SpotterOrganization {
    id: number;
    name?: string;
}

// HubSpot CSV Row Interface
export interface HubSpotDealLineItemRow {
    'Nome do negócio': string;
    'Pipeline': string;
    'Etapa do negócio': string;
    'Nome': string; // Line Item Name
    'Preço unitário': string;
    'Quantidade': string;
    'spotter_lead_id': string;
    'spotter_sale_id': string;
    'spotter_sale_date': string;
    'spotter_sale_stage': string;
    'spotter_cycle': string;
    'spotter_total_deal_value': string;
    'spotter_salesrep_email': string;
    'spotter_presales_email': string;
    'origem_comercial_real': string;
    'spotter_product_id': string;
    'spotter_individual_value': string;
    'spotter_discount_amount': string;
    'spotter_discount_type': string;
    'spotter_final_value': string;
}

// Log object for the JSON file
type LogObject = {
  totalLeadsFetched: number;
  totalOrgsFetched: number;
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
async function fetchAllLeads(token: string, baseUrl: string, log: LogCallback): Promise<Map<number, { leadName?: string; organizationId?: number | null; sourceValue?: string }>> {
    const leads = await fetchAllSpotterDataWithRetries<SpotterLead>(`${baseUrl}/v3/Leads`, token, log);
    const leadMap = new Map<number, { leadName?: string; organizationId?: number | null; sourceValue?: string }>();
    for (const lead of leads) {
        leadMap.set(lead.id, {
            leadName: lead.lead,
            organizationId: lead.organizationId,
            sourceValue: lead.source?.value,
        });
    }
    return leadMap;
}

async function fetchAllOrganizations(token: string, baseUrl: string, log: LogCallback): Promise<Map<number, string>> {
    const orgs = await fetchAllSpotterDataWithRetries<SpotterOrganization>(`${baseUrl}/v3/organization`, token, log);
    const orgMap = new Map<number, string>();
    for (const org of orgs) {
        if (org.name) {
            orgMap.set(org.id, org.name);
        }
    }
    return orgMap;
}

async function fetchAllLeadsSold(token: string, baseUrl: string, log: LogCallback): Promise<SpotterSale[]> {
  return fetchAllSpotterDataWithRetries<SpotterSale>(`${baseUrl}/v3/LeadsSold`, token, log);
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
  leadMap: Map<number, { leadName?: string; organizationId?: number | null; sourceValue?: string }>,
  orgMap: Map<number, string>,
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

    const primaryProduct = products[0];
    const primaryProductName = primaryProduct?.name?.replace(/[\r\n]/g, ' ') ||
                               (primaryProduct?.id ? `Produto Spotter ${primaryProduct.id}` : "Produto Spotter");

    const leadInfo = leadMap.get(sale.leadId);
    const companyName = leadInfo?.organizationId ? orgMap.get(leadInfo.organizationId) : undefined;
    const leadName = leadInfo?.leadName?.replace(/[\r\n]/g, ' ');

    let dealName = '';
    if (companyName) {
        dealName = `${companyName} - ${primaryProductName}`;
    } else if (leadName) {
        dealName = `${leadName} - ${primaryProductName}`;
    } else {
        dealName = `Lead ${sale.leadId} - ${primaryProductName}`;
    }

    const dealData = {
      'Nome do negócio': dealName,
      'Pipeline': HUBSPOT_PIPELINE,
      'Etapa do negócio': HUBSPOT_DEAL_STAGE_SOLD,
      'spotter_lead_id': String(sale.leadId),
      'spotter_sale_id': String(sale.id),
      'spotter_sale_date': formatDateBR(sale.saleDate),
      'spotter_sale_stage': sale.saleStage ?? '',
      'spotter_cycle': String(sale.cycle ?? ''),
      'spotter_total_deal_value': String(sale.totalDealValue ?? 0),
      'spotter_salesrep_email': sale.salesRep?.email ?? '',
      'spotter_presales_email': sale.preSales?.email ?? '',
      'origem_comercial_real': leadInfo?.sourceValue ?? '',
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
  const logObject: LogObject = {
    totalLeadsFetched: 0,
    totalOrgsFetched: 0,
    totalSalesFetched: 0,
    totalRowsGenerated: 0,
    warnings: [],
    errors: [],
    csvSample: [],
  };

  try {
    log('Fetching Leads from /v3/Leads...');
    const leadMap = await fetchAllLeads(token, baseUrl, log);
    logObject.totalLeadsFetched = leadMap.size;
    log(`Fetched ${leadMap.size} unique leads.`);

    log('Fetching Organizations from /v3/organization...');
    const orgMap = await fetchAllOrganizations(token, baseUrl, log);
    logObject.totalOrgsFetched = orgMap.size;
    log(`Fetched ${orgMap.size} unique organizations.`);

    log('Fetching sales data from /v3/LeadsSold...');
    const leadsSold = await fetchAllLeadsSold(token, baseUrl, log);
    logObject.totalSalesFetched = leadsSold.length;
    log(`Fetched ${leadsSold.length} sales records.`);

    log('Building CSV rows...');
    const rows = buildDealsAndLineItemsRows(leadsSold, leadMap, orgMap, logObject);
    logObject.totalRowsGenerated = rows.length;
    log(`Generated ${rows.length} CSV rows.`);

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
