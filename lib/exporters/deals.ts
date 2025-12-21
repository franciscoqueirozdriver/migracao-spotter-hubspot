
import { paginateOData } from '../exactSpotter/paginate';
import { generateCsvFromRows } from '../csv/writer';
import { LogCallback, ExportLog } from '../exporter';

interface SpotterLeadSold {
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

interface SpotterLead {
    id: number;
    organizationId?: number | null;
    stage?: string | null;
    source?: string | null;
    lead?: string | null;
    pipeline?: string | null; // Assuming pipeline is available on Lead
}

interface SpotterLost {
    leadId: number;
    date: string;
    reason?: string;
}

interface SpotterPerson {
    id: number;
    leadId?: number | null;
    mainContact?: boolean | null;
}

// SAFE STRING LOWERCASE HELPER
function toLowerText(input: unknown): string {
    if (typeof input === "string") return input.toLowerCase();
    if (input instanceof Error) return (input.message ?? "").toLowerCase();
    try { return String(input ?? "").toLowerCase(); } catch { return ""; }
}

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
    const normalized = toLowerText(sourceValue).normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    if (normalized.includes('prospeccao ativa') || normalized.includes('outbound')) return 'Outbound';
    if (normalized.includes('carteira de clientes') || normalized.includes('base') || normalized.includes('white space')) return 'White Space (Base)';
    if (normalized.includes('indicacao') || normalized.includes('programa')) return 'Base Viral (Programa de Indicação)';
    if (normalized.includes('parceiros') || normalized.includes('partner')) return 'Parceiros';

    return 'Inbound';
}

function normalizeDiscountType(type?: string): string {
    if (!type) return 'Nenhum';
    const lowerType = toLowerText(type);
    if (lowerType.includes('absoluto')) return 'Absoluto';
    if (lowerType.includes('percentual')) return 'Porcentual';
    return type;
}

export async function generateDealsItemsCsvStrict(token: string, baseUrl: string, log: LogCallback, currentLog: ExportLog): Promise<string> {
    log('--- Starting Deals + Items Export (negocios_itens.csv) ---');

    // 1. Fetch All Leads (BASE)
    log('Fetching Leads (Base)...');
    const allLeads = await paginateOData<SpotterLead>(baseUrl, '/v3/Leads', token, log);
    currentLog.totals.leadsFetched = allLeads.length;
    const leadsMap = new Map(allLeads.map(l => [l.id, l]));
    log(`Fetched ${allLeads.length} leads.`);

    // 2. Fetch Sold (ENRIQUECIMENTO)
    log('Fetching LeadsSold...');
    const leadsSold = await paginateOData<SpotterLeadSold>(baseUrl, '/v3/LeadsSold', token, log);
    currentLog.totals.soldFetched = leadsSold.length;
    const soldMap = new Map(leadsSold.map(s => [s.leadId, s]));
    log(`Fetched ${leadsSold.length} sold leads.`);

    // 3. Fetch Losts (ENRIQUECIMENTO)
    log('Fetching Losts...');
    const losts = await paginateOData<SpotterLost>(baseUrl, '/v3/Losts', token, log);
    currentLog.totals.lostFetched = losts.length;
    const lostMap = new Map(losts.map(l => [l.leadId, l]));
    log(`Fetched ${losts.length} lost leads.`);

    // 4. Fetch Persons (ENRIQUECIMENTO)
    // Optimization: If possible filter by leads we have, but "all leads" means "all persons" likely needed.
    log('Fetching Persons...');
    const allPersons = await paginateOData<SpotterPerson>(baseUrl, '/v3/Persons', token, log);

    const personsByLead = new Map<number, SpotterPerson[]>();
    for (const p of allPersons) {
        if (p.leadId) {
            const list = personsByLead.get(p.leadId) ?? [];
            list.push(p);
            personsByLead.set(p.leadId, list);
        }
    }
    const mainPersonIdByLeadId = new Map<number, number>();
    for (const [leadId, persons] of Array.from(personsByLead.entries())) {
        const main = persons.find(p => p.mainContact) ?? persons[0];
        if (main) mainPersonIdByLeadId.set(leadId, main.id);
    }

    // Headers
    const headers = [
        'Nome do negócio',
        'Pipeline',
        'Etapa do negócio',
        'spotter_sale_id',
        'spotter_lead_id',
        'spotter_sale_date',
        'spotter_sale_stage',
        'spotter_cycle',
        'spotter_total_deal_value',
        'spotter_salesrep_email',
        'spotter_presales_email',
        'origem_comercial_real',
        'spotter_organization_id',
        'spotter_person_id',
        'Nome',
        'Quantidade',
        'Preço unitário',
        'spotter_product_id',
        'spotter_discount_amount',
        'spotter_discount_type',
        'spotter_final_value'
    ];

    const rows: string[][] = [];
    let dealsGenerated = 0;
    let lineItemsGenerated = 0;
    let leadsWithoutOrg = 0;
    let leadsWithoutPerson = 0;

    for (const lead of allLeads) {
        // Determine status and enrichment data
        const soldData = soldMap.get(lead.id);
        const lostData = lostMap.get(lead.id);

        let stage = 'Pré-venda'; // Default
        let saleId = '';
        let saleDate = '';
        let saleStage = ''; // Original spotter stage
        let cycle = '';
        let totalValue = '0';
        let salesRepEmail = '';
        let preSalesEmail = '';
        let products: SpotterLeadSold['products'] = [];

        // Priority: Sold > Lost > Open
        if (soldData) {
            stage = 'Vendido';
            saleId = String(soldData.id);
            saleDate = formatDateBR(soldData.saleDate);
            saleStage = soldData.saleStage ?? '';
            cycle = String(soldData.cycle ?? '');
            totalValue = String(soldData.totalDealValue ?? 0);
            salesRepEmail = soldData.salesRep?.email ?? '';
            preSalesEmail = soldData.preSales?.email ?? '';
            products = soldData.products ?? [];
        } else if (lostData) {
            stage = 'Perdido';
            saleDate = formatDateBR(lostData.date);
            // Lost doesn't have saleId, cycle, value, products usually
            // Maybe map reason to something? Requirement says "lost_reason = reason" but CSV header doesn't have it.
            // "PASSO 3 ... lost_reason = reason (se existir coluna)".
            // The header list provided in PASSO 4 DOES NOT include 'lost_reason'.
            // "Cabeçalhos DEVEM SER EXATAMENTE: ... spotter_final_value" -> No lost_reason.
            // So we ignore lost_reason for the CSV, but set stage = 'Perdido'.
        } else {
            // Open / Active
            stage = 'Pré-venda'; // Or use lead.stage if available and mapped
             // "dealstage = estágio inicial (pré-venda)"
        }

        const personId = mainPersonIdByLeadId.get(lead.id);
        const orgId = lead.organizationId;
        const origem = mapOrigemComercialReal(lead.source ?? undefined);

        if (!personId) leadsWithoutPerson++;
        if (!orgId) leadsWithoutOrg++;

        // Deal Name
        // "dealname = usar nome disponível (fallback seguro)"
        // If sold, we might have products to name it "Lead - Product".
        // If not sold, "Lead - ?" or just Lead Name.
        // Requirement: "Deal Name follows ... {companyName} - {primaryProductName}, falling back to {leadName} - {primaryProductName}..."
        // We don't have companyName here easily (unless we fetch orgs too).
        // Let's stick to "{leadName} - {primaryProductName}" or just "{leadName}" if no product.

        let primaryProductName = '';
        if (products && products.length > 0) {
            primaryProductName = products[0].name ?? `Produto ${products[0].id}`;
        }

        let dealName = lead.lead ?? `Lead ${lead.id}`;
        if (primaryProductName) {
            dealName = `${dealName} - ${primaryProductName}`;
        }

        // Generate Rows
        if (stage === 'Vendido' && products && products.length > 0) {
            // Generate 1 row per product
            for (const product of products) {
                rows.push([
                    dealName,
                    'default',
                    stage,
                    saleId,
                    String(lead.id),
                    saleDate,
                    saleStage,
                    cycle,
                    totalValue,
                    salesRepEmail,
                    preSalesEmail,
                    origem,
                    String(orgId ?? ''),
                    String(personId ?? ''),
                    product.name ?? '',
                    String(product.quantity ?? 1),
                    String(product.individualValue ?? 0),
                    String(product.id),
                    String(product.discountAmount ?? 0),
                    normalizeDiscountType(product.discountType),
                    String(product.finalValue ?? 0)
                ]);
                lineItemsGenerated++;
            }
            dealsGenerated++; // Count deal once (conceptually)
        } else {
            // Open or Lost, or Sold but no products
            // Generate 1 row with empty product info
            rows.push([
                dealName,
                'default',
                stage,
                saleId, // Might be empty if not sold
                String(lead.id),
                saleDate,
                saleStage,
                cycle,
                totalValue,
                salesRepEmail,
                preSalesEmail,
                origem,
                String(orgId ?? ''),
                String(personId ?? ''),
                '', // Nome
                '', // Quantidade
                '', // Preço unitário
                '', // spotter_product_id
                '', // discount amount
                '', // discount type
                ''  // final value
            ]);
            dealsGenerated++;
        }
    }

    currentLog.totals.dealsGenerated = dealsGenerated;
    currentLog.totals.lineItemsGenerated = lineItemsGenerated;
    currentLog.discards.leadsWithoutOrg = leadsWithoutOrg;
    currentLog.discards.leadsWithoutPerson = leadsWithoutPerson;

    const csvContent = generateCsvFromRows(headers, rows);
    return '\ufeff' + csvContent;
}
