
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
    stage?: string | { name?: string } | null;
    source?: string | null;
    lead?: string | null;
    pipeline?: string | null;
}

interface SpotterLost {
    leadId: number;
    date: string;
    reason?: string;
    stage?: string; // Adding based on requirement "stage do Lost"
}

interface SpotterPerson {
    id: number;
    leadId?: number | null;
    mainContact?: boolean | null;
}

interface RecommendedProduct {
    leadId: number;
    productId: number;
    quantity: number;
    labelValue?: number;
    amount?: number;
    descountType?: string; // Correcting likely typo 'descount' to 'discount' usage but API says 'descountType'
    descountValue?: number;
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

function getLeadStageName(lead: SpotterLead): string | "" {
    const s = lead.stage;
    if (typeof s === "string") return s.trim();
    if (s && typeof s === "object") {
      const name = (s as any).name; // Safe access
      if (typeof name === "string") return name.trim();
    }
    return "";
}

export async function generateDealsItemsCsvStrict(token: string, baseUrl: string, log: LogCallback, currentLog: ExportLog): Promise<string> {
    log('--- Starting Deals + Items Export (negocios_itens.csv) ---');

    // 1. Fetch All Leads (BASE)
    log('Fetching Leads (Base)...');
    const allLeads = await paginateOData<SpotterLead>(baseUrl, '/v3/Leads', token, log);
    currentLog.totals.leadsFetched = allLeads.length;
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

    // 4. Fetch Recommended Products (ENRIQUECIMENTO - Abertos)
    log('Fetching Recommended Products...');
    // Note: Assuming endpoint is /v3/recommendedProducts as per instruction
    const recommended = await paginateOData<RecommendedProduct>(baseUrl, '/v3/recommendedProducts', token, log);
    // Add to logs (using any/extension for now as interface might not have it yet, or assume it does in next step)
    (currentLog.totals as any).recommendedFetched = recommended.length;

    const recommendedMap = new Map<number, RecommendedProduct[]>();
    for (const rp of recommended) {
        const list = recommendedMap.get(rp.leadId) ?? [];
        list.push(rp);
        recommendedMap.set(rp.leadId, list);
    }
    log(`Fetched ${recommended.length} recommended products.`);

    // 5. Fetch Persons (ENRIQUECIMENTO)
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

    // Counters for audit
    let itemsFromSold = 0;
    let itemsFromRecommended = 0;

    for (const lead of allLeads) {
        const soldData = soldMap.get(lead.id);
        const lostData = lostMap.get(lead.id);
        const recommendedData = recommendedMap.get(lead.id) ?? [];

        let stage = '';
        let saleId = '';
        let saleDate = '';
        let saleStage = '';
        let cycle = '';
        let totalValue = '0';
        let salesRepEmail = '';
        let preSalesEmail = '';

        // We will build a unified list of "items" to export
        // Each item has: name, qty, price, id, discountAmt, discountType, finalVal
        interface LineItem {
            name: string;
            qty: number;
            price: number;
            id: string;
            discAmt: number;
            discType: string;
            finalVal: number;
        }
        let itemsToExport: LineItem[] = [];

        // STRICT LOGIC: Sold > Lost > Lead

        if (soldData) {
            // Case 1: Sold
            stage = soldData.saleStage ?? '';
            if (!stage) {
                log(`WARNING: Sold Lead ${lead.id} has no saleStage. Using empty string.`);
            }

            saleId = String(soldData.id);
            saleDate = formatDateBR(soldData.saleDate);
            saleStage = soldData.saleStage ?? '';
            cycle = String(soldData.cycle ?? '');
            totalValue = String(soldData.totalDealValue ?? 0);
            salesRepEmail = soldData.salesRep?.email ?? '';
            preSalesEmail = soldData.preSales?.email ?? '';

            // Map sold products
            itemsToExport = (soldData.products ?? []).map(p => ({
                name: p.name ?? `Produto ${p.id}`,
                qty: p.quantity ?? 1,
                price: p.individualValue ?? 0,
                id: String(p.id),
                discAmt: p.discountAmount ?? 0,
                discType: normalizeDiscountType(p.discountType),
                finalVal: p.finalValue ?? 0
            }));

            itemsFromSold += itemsToExport.length;

        } else if (lostData) {
            // Case 2: Lost
            // "stage do Lost (nome da etapa de descarte)"
            // If lostData.stage exists, use it. If not, maybe reason?
            // Requirement says: "Etapa do negócio = stage do Lost"
            stage = lostData.stage ?? '';
            if (!stage) {
                log(`WARNING: Lost Lead ${lead.id} has no stage. Using empty string.`);
                // If strict requirement allows reason fallback? "stage do Lost (nome da etapa de descarte)"
                // Assuming strict adherence to 'stage' property existence.
            }

            saleDate = formatDateBR(lostData.date);
            // No items for Lost
            itemsToExport = [];

        } else {
            // Case 3: Open (Not Sold, Not Lost)
            const extractedStage = getLeadStageName(lead);
            if (extractedStage) {
                stage = extractedStage;
            } else {
                // Requirement: "PROIBIDO preencher “Pré-venda” como fallback genérico"
                // "Nesses casos, preencher com string vazia "" (não inventar valor)"
                stage = '';
                log(`WARNING: Open Lead ${lead.id} has no stage name. Using empty string.`);
            }

            // Map recommended products for Open leads
            itemsToExport = recommendedData.map(p => {
                const qty = p.quantity ?? 1;
                // Price logic: labelValue OR amount/quantity
                let price = p.labelValue ?? 0;
                if (price === 0 && (p.amount ?? 0) > 0 && qty > 0) {
                    price = (p.amount ?? 0) / qty;
                }

                return {
                    name: `Produto ${p.productId}`, // Fallback as we don't have name in recommended payload usually
                    qty: qty,
                    price: price,
                    id: String(p.productId),
                    discAmt: p.descountValue ?? 0,
                    discType: normalizeDiscountType(p.descountType),
                    finalVal: p.amount ?? 0
                };
            });

            itemsFromRecommended += itemsToExport.length;
        }

        const personId = mainPersonIdByLeadId.get(lead.id);
        const orgId = lead.organizationId;
        const origem = mapOrigemComercialReal(lead.source ?? undefined);

        if (!personId) leadsWithoutPerson++;
        if (!orgId) leadsWithoutOrg++;

        // Deal Name
        let dealName = lead.lead ?? `Lead ${lead.id}`;
        // If items exist, append first product name?
        // Logic was: {leadName} - {primaryProductName}
        if (itemsToExport.length > 0) {
            dealName = `${dealName} - ${itemsToExport[0].name}`;
        }

        // GENERATE ROWS
        if (itemsToExport.length > 0) {
            for (const item of itemsToExport) {
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
                    item.name,
                    String(item.qty),
                    String(item.price),
                    item.id,
                    String(item.discAmt),
                    item.discType,
                    String(item.finalVal)
                ]);
                lineItemsGenerated++;
            }
        } else {
            // 1 row, empty items
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
                '', '', '', '', '', '', ''
            ]);
        }
        dealsGenerated++;
    }

    currentLog.totals.dealsGenerated = dealsGenerated;
    currentLog.totals.lineItemsGenerated = lineItemsGenerated;
    currentLog.discards.leadsWithoutOrg = leadsWithoutOrg;
    currentLog.discards.leadsWithoutPerson = leadsWithoutPerson;

    // Add extra stats if possible or just log them
    (currentLog.totals as any).itemsFromSold = itemsFromSold;
    (currentLog.totals as any).itemsFromRecommended = itemsFromRecommended;

    const csvContent = generateCsvFromRows(headers, rows);
    return '\ufeff' + csvContent;
}
