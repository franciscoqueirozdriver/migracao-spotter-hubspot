import { fetchAllSpotterOData } from './spotter';
import { buildCsv, sanitizeCsvValue } from './csv';
import { writeFile } from 'fs/promises';
import { join } from 'path';

//region Type Definitions

// Spotter API Interfaces
interface SpotterProductLine {
  id: number;
  name: string;
  quantity: number;
  individualValue: number;
  discountAmount: number | null;
  discountType: string | null;
  fullValue: number;
  finalValue: number;
}

export interface SpotterLeadSold {
  leadId: number;
  saleDate: string;
  saleStage: string;
  cycle: string | null;
  totalDealValue: number;
  id: number; // Sale ID
  products?: SpotterProductLine[];
}

// HubSpot CSV Row Interface
export interface HubSpotDealAndLineItemRow {
  'Deal Name': string;
  'Pipeline': string;
  'Deal Stage': string;
  'Line Item Name': string;
  'Unit Price': string; // Using string to handle comma formatting for HubSpot
  'Quantity': number;
  'spotter_lead_id': number;
  'spotter_sale_id': number; // Maps to Deal
  'ciclo_spotter': string;
  'spotter_sale_stage': string;
  'spotter_sale_date': string;
  'origem_comercial_real': string; // Empty as per requirement
  'spotter_product_id': number; // Maps to Line Item
  'spotter_line_item_sale_id': number; // Custom property to link line item back to the sale
  'spotter_full_value': number;
  'spotter_final_value': number;
  'spotter_discount_amount': number;
  'spotter_discount_type': string;
}

// Log Callback Type
export type LogCallback = (message: string) => void;

type LogObject = {
  totalLeadsSold: number;
  totalLineItems: number;
  warnings: {
    message: string;
    example: unknown;
  }[];
};

//endregion

//region Mappings

const SALE_STAGE_TO_DEAL_STAGE_MAP: Record<string, string> = {
  'QUALIFICADO': 'Entrada',
  'CONTRATO ENVIADO': 'Proposta/Contrato Enviado',
  'NEGOCIACAO': 'Negociação',
  // Add other mappings as needed
};
const DEFAULT_DEAL_STAGE = 'Entrada';
const DEFAULT_PIPELINE = 'default';

//endregion

//region Data Fetching

export async function fetchAllLeadsSold(
  token: string,
  baseUrl: string,
  log: LogCallback
): Promise<SpotterLeadSold[]> {
  const initialUrl = `${baseUrl}/v3/LeadsSold`;
  return fetchAllSpotterOData<SpotterLeadSold>(initialUrl, token, log);
}

//endregion

//region Data Transformation and CSV Building

/**
 * Transforms Spotter sale data into an array of HubSpot-compatible CSV rows.
 * Each product in a sale becomes a separate row (a line item).
 * @param leadsSold - Array of sales data from Spotter.
 * @param log - Callback function for logging warnings.
 * @returns An array of objects representing rows for the CSV.
 */
export function buildDealsAndLineItemsRows(
  leadsSold: SpotterLeadSold[],
  log: LogCallback
): { rows: HubSpotDealAndLineItemRow[]; logObject: LogObject } {
  const rows: HubSpotDealAndLineItemRow[] = [];
  const logObject: LogObject = {
    totalLeadsSold: leadsSold.length,
    totalLineItems: 0,
    warnings: [],
  };

  for (const sale of leadsSold) {
    const products = sale.products ?? [];
    if (products.length === 0) {
      logObject.warnings.push({
        message: `Venda com ID ${sale.id} (Lead ID: ${sale.leadId}) não possui itens de linha e será ignorada.`,
        example: { saleId: sale.id, leadId: sale.leadId },
      });
      continue; // Skip sales without products
    }

    logObject.totalLineItems += products.length;

    const dealStage = SALE_STAGE_TO_DEAL_STAGE_MAP[sale.saleStage] ?? DEFAULT_DEAL_STAGE;
    if (!SALE_STAGE_TO_DEAL_STAGE_MAP[sale.saleStage]) {
      logObject.warnings.push({
        message: `Etapa de venda "${sale.saleStage}" não mapeada. Usando etapa padrão: "${DEFAULT_DEAL_STAGE}".`,
        example: { saleStage: sale.saleStage, saleId: sale.id },
      });
    }

    for (const product of products) {
      // Unit price calculation: use individualValue, but if there's a discount and quantity > 0,
      // it might be better to use finalValue / quantity. Let's stick to individualValue for now as requested.
      const unitPrice = (product.individualValue ?? 0).toString().replace('.', ',');

      const row: HubSpotDealAndLineItemRow = {
        'Deal Name': `Spotter #${sale.leadId} — Venda #${sale.id}`,
        'Pipeline': DEFAULT_PIPELINE,
        'Deal Stage': dealStage,
        'Line Item Name': product.name,
        'Unit Price': unitPrice,
        'Quantity': product.quantity ?? 1,
        'spotter_lead_id': sale.leadId,
        'spotter_sale_id': sale.id,
        'ciclo_spotter': sale.cycle ?? '',
        'spotter_sale_stage': sale.saleStage,
        'spotter_sale_date': sale.saleDate,
        'origem_comercial_real': '', // As per requirement
        'spotter_product_id': product.id,
        'spotter_line_item_sale_id': sale.id, // Explicitly linking line item to the sale
        'spotter_full_value': product.fullValue ?? 0,
        'spotter_final_value': product.finalValue ?? 0,
        'spotter_discount_amount': product.discountAmount ?? 0,
        'spotter_discount_type': product.discountType ?? '',
      };
      rows.push(row);
    }
  }

  log(
    `Processamento concluído. ${rows.length} linhas de itens de linha geradas a partir de ${leadsSold.length} vendas.`
  );
  if (logObject.warnings.length > 0) {
    log(`Foram registrados ${logObject.warnings.length} avisos. Verifique o arquivo de log para mais detalhes.`);
  }

  return { rows, logObject };
}

//endregion


//region Main Export Function

export async function exportDealsAndLineItemsToCsv(
  token: string,
  baseUrl: string,
  log: LogCallback
): Promise<{ csvContent: string }> {
  log('Iniciando exportação de Negócios e Itens de Linha...');

  // 1. Fetch data
  const leadsSold = await fetchAllLeadsSold(token, baseUrl, log);
  if (leadsSold.length === 0) {
    log('Nenhuma venda encontrada para exportar.');
    return { csvContent: '' };
  }

  // 2. Transform data
  log('Transformando dados para o formato HubSpot...');
  const { rows, logObject } = buildDealsAndLineItemsRows(leadsSold, log);

  // 3. Build CSV
  if (rows.length === 0) {
    log('Nenhuma linha de item de linha foi gerada. O CSV estará vazio.');
     await writeLogFile(logObject); // Still write the log
    return { csvContent: '' };
  }
  log('Gerando conteúdo do arquivo CSV...');
  const headers = Object.keys(rows[0]);
  const csvRows = rows.map(row =>
    headers.map(header =>
      sanitizeCsvValue(row[header as keyof HubSpotDealAndLineItemRow])
    )
  );

  const csvContent = buildCsv(headers, csvRows);
  log('Geração do CSV concluída.');


  // 4. Write Log File
  await writeLogFile(logObject);


  return { csvContent };
}

async function writeLogFile(logObject: LogObject): Promise<void> {
  const exportsDir = join(process.cwd(), 'exports');
  const logFilePath = join(exportsDir, 'spotter_to_hubspot_deals_line_items.log.json');
  try {

    await writeFile(logFilePath, JSON.stringify(logObject, null, 2), 'utf-8');
    console.log(`Log file saved to ${logFilePath}`);
  } catch (error) {
    console.error('Failed to write log file:', error);
    // Do not throw, as this is a side effect and shouldn't fail the main operation.
  }
}
//endregion
