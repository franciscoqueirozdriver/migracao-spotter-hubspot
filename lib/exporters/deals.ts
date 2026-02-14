
import { paginateOData } from '../exactSpotter/paginate';
import { generateCsvFromRows } from '../csv/writer';
import { LogCallback, ExportLog } from '../exporter';
import { formatMoneyBR } from '../formatters/money';

interface SpotterLeadSold {
    leadId: number;
    saleDate: string;
    saleStage?: string;
    cycle?: number;
    totalDealValue?: number | string;
    id: number;
    products?: {
      id: number;
      name?: string;
      quantity?: number;
      individualValue?: number | string;
      discountAmount?: number | string;
      discountType?: string;
      finalValue?: number | string;
    }[];
    salesRep?: { email?: string };
    preSales?: { email?: string };
}

interface SpotterLead {
    id: number;
    organizationId?: number | null;
    stage?: string | { name?: string } | null;
    source?: { id?: number; value?: string } | null;
    lead?: string | null;
    pipeline?: string | null;
    registerDate?: string;
    registrationDate?: string;
    createDate?: string;
}

interface SpotterLost {
    leadId: number;
    date: string;
    reason?: string;
    stage?: string;
}

interface SpotterPerson {
    id: number;
    leadId?: number | null;
    mainContact?: boolean | null;
    name?: string;
}

interface SpotterOrg {
    id: number;
    name: string;
}

interface RecommendedProduct {
    leadId: number;
    productId: number;
    quantity: number;
    labelValue?: number | string;
    amount?: number | string;
    descountType?: string;
    descountValue?: number | string;
}

interface SpotterProduct {
    id: number;
    name?: string;
    description?: string;
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

function formatDateISO(isoString?: string): string {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '';
      return date.toISOString().split('T')[0];
    } catch {
      return '';
    }
}

function mapOrigemComercialReal(sourceValue?: string): string {
    if (!sourceValue) return '';
    const normalized = toLowerText(sourceValue).normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    if (normalized.includes('prospeccao ativa') || normalized.includes('outbound')) return 'Outbound';
    if (normalized.includes('carteira de clientes') || normalized.includes('base') || normalized.includes('white space')) return 'White Space (Base)';
    if (normalized.includes('indicacao') || normalized.includes('programa')) return 'Base Viral (Programa de Indicação)';
    if (normalized.includes('parceiros') || normalized.includes('partner')) return 'Parceiros';
    if (normalized.includes('inbound')) return 'Inbound';

    return sourceValue;
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

function getFirstTwoWords(name?: string | null): string {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    return parts.slice(0, 2).join(' ');
}

function getLeadCreationDate(lead: SpotterLead): string {
    return lead.registerDate ?? lead.registrationDate ?? lead.createDate ?? '';
}

export async function generateDealsItemsCsvStrict(token: string, baseUrl: string, log: LogCallback, currentLog: ExportLog): Promise<string> {
    log('--- Starting Deals + Items Export (negocios_itens.csv) ---');

    // 1. Fetch All Leads (BASE)
    log('Fetching Leads (Base)...');
    const allLeads = await paginateOData<SpotterLead>(baseUrl, '/v3/Leads', token, log);
    currentLog.totals.leadsFetched = allLeads.length;
    // Map leads by ID for easy lookup if needed, but we iterate allLeads anyway
    const leadsById = new Map(allLeads.map(l => [String(l.id), l]));
    log(`Fetched ${allLeads.length} leads.`);

    // 2. Fetch Sold (ENRIQUECIMENTO)
    log('Fetching LeadsSold...');
    const leadsSold = await paginateOData<SpotterLeadSold>(baseUrl, '/v3/LeadsSold', token, log);
    currentLog.totals.soldFetched = leadsSold.length;
    const soldMap = new Map(leadsSold.map(s => [String(s.leadId), s]));
    log(`Fetched ${leadsSold.length} sold leads.`);

    // 3. Fetch Losts (ENRIQUECIMENTO)
    log('Fetching Losts...');
    const losts = await paginateOData<SpotterLost>(baseUrl, '/v3/Losts', token, log);
    currentLog.totals.lostFetched = losts.length;
    const lostMap = new Map(losts.map(l => [String(l.leadId), l]));
    log(`Fetched ${losts.length} lost leads.`);

    // 4. Fetch Recommended Products (ENRIQUECIMENTO - Abertos)
    log('Fetching Recommended Products...');
    const recommended = await paginateOData<RecommendedProduct>(baseUrl, '/v3/recommendedProducts', token, log);
    (currentLog.totals as any).recommendedFetched = recommended.length;

    const recommendedMap = new Map<string, RecommendedProduct[]>();
    for (const rp of recommended) {
        const key = String(rp.leadId);
        const list = recommendedMap.get(key) ?? [];
        list.push(rp);
        recommendedMap.set(key, list);
    }
    log(`Fetched ${recommended.length} recommended products.`);

    // NEW: Fetch Product Catalog
    log('Fetching Product Catalog...');
    const products = await paginateOData<SpotterProduct>(baseUrl, '/v3/products', token, log);
    (currentLog.totals as any).productsCatalogFetched = products.length;
    const productsById = new Map(products.map(p => [String(p.id), p]));
    log(`Fetched ${products.length} catalog products.`);

    // 5. Fetch Persons (ENRIQUECIMENTO)
    log('Fetching Persons...');
    const allPersons = await paginateOData<SpotterPerson>(baseUrl, '/v3/Persons', token, log);

    const personsByLead = new Map<string, SpotterPerson[]>();
    for (const p of allPersons) {
        if (p.leadId) {
            const key = String(p.leadId);
            const list = personsByLead.get(key) ?? [];
            list.push(p);
            personsByLead.set(key, list);
        }
    }
    const mainPersonIdByLeadId = new Map<string, number>();
    for (const [leadId, persons] of Array.from(personsByLead.entries())) {
        const main = persons.find(p => p.mainContact) ?? persons[0];
        if (main) mainPersonIdByLeadId.set(leadId, main.id);
    }

    // NEW: Fetch Organizations to get Company Name
    log('Fetching Organizations...');
    const allOrgs = await paginateOData<SpotterOrg>(baseUrl, '/v3/organization', token, log);
    const orgsById = new Map(allOrgs.map(o => [String(o.id), o]));
    log(`Fetched ${allOrgs.length} organizations.`);

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
        'Produto',
        'Quantidade',
        'Preço unitário',
        'spotter_product_id',
        'spotter_discount_amount',
        'spotter_discount_type',
        'spotter_final_value',
        'Data da Criação do Negócio',
        'Data de Fechamento do Negócio'
    ];

    const rows: string[][] = [];
    let dealsGenerated = 0;
    let lineItemsGenerated = 0;
    let leadsWithoutOrg = 0;
    let leadsWithoutPerson = 0;
    let itemsFromSold = 0;
    let itemsFromRecommended = 0;
    let itemNameFallbackCount = 0;

    for (const lead of allLeads) {
        const leadIdStr = String(lead.id);
        const soldData = soldMap.get(leadIdStr);
        const lostData = lostMap.get(leadIdStr);
        const recommendedData = recommendedMap.get(leadIdStr) ?? [];
        const personId = mainPersonIdByLeadId.get(leadIdStr);
        const orgId = lead.organizationId ? String(lead.organizationId) : undefined;
        const org = orgId ? orgsById.get(orgId) : undefined;
        const mainPerson = personId ? personsByLead.get(leadIdStr)?.find(p => p.id === personId) : undefined;

        let stage = '';
        let saleId = '';
        let saleDate = '';
        let saleStage = '';
        let cycle = '';
        let totalValue = '0'; // Processed below
        let salesRepEmail = '';
        let preSalesEmail = '';

        // Date Logic
        const createdAt = formatDateISO(getLeadCreationDate(lead));
        let closedAt = '';

        interface LineItem {
            name: string;
            qty: number;
            price: string; // Formatted
            id: string;
            discAmt: string; // Formatted
            discType: string;
            finalVal: string; // Formatted
            productIdForNameRes?: number;
        }
        let itemsToExport: LineItem[] = [];

        // STRICT LOGIC: Sold > Lost > Lead

        if (soldData) {
            // Case 1: Sold
            stage = 'Vendido';

            saleId = String(soldData.id);
            saleDate = formatDateISO(soldData.saleDate); // CORRECTED TO ISO
            saleStage = soldData.saleStage ?? '';
            cycle = String(soldData.cycle ?? '');

            // Format Total Deal Value with new strict formatter (PT-BR)
            totalValue = formatMoneyBR(soldData.totalDealValue);

            salesRepEmail = soldData.salesRep?.email ?? '';
            preSalesEmail = soldData.preSales?.email ?? '';

            closedAt = formatDateISO(soldData.saleDate);

            itemsToExport = (soldData.products ?? []).map(p => {
                let name = '';
                const catalogDesc = productsById.get(String(p.id))?.description;
                if (catalogDesc) {
                    name = catalogDesc;
                } else {
                    name = p.name ?? `Produto ${p.id}`;
                    if (!p.name) {
                        itemNameFallbackCount++;
                        log(`WARN_PRODUCT_NOT_FOUND: Product ${p.id} has no name in Sold Lead ${lead.id} and not in Catalog.`);
                    }
                }

                return {
                    name: name,
                    qty: p.quantity ?? 1,
                    price: formatMoneyBR(p.individualValue),
                    id: String(p.id),
                    discAmt: formatMoneyBR(p.discountAmount),
                    discType: normalizeDiscountType(p.discountType),
                    finalVal: formatMoneyBR(p.finalValue),
                    productIdForNameRes: p.id
                };
            });

            itemsFromSold += itemsToExport.length;

        } else if (lostData) {
            // Case 2: Lost
            stage = 'Perdido';

            saleDate = formatDateISO(lostData.date); // CORRECTED TO ISO
            itemsToExport = [];

            closedAt = formatDateISO(lostData.date);

        } else {
            // Case 3: Open
            const extractedStage = getLeadStageName(lead);
            if (extractedStage) {
                stage = extractedStage;
            } else {
                stage = '';
                log(`WARNING: Open Lead ${lead.id} has no stage name. Using empty string.`);
            }

            closedAt = '';

            itemsToExport = recommendedData.map(p => {
                const qty = p.quantity ?? 1;
                let rawPrice = p.labelValue ?? 0;

                // Keep raw price check for log logic before string formatting
                if (rawPrice === 0 || rawPrice === '0') {
                     log(`WARN_UNIT_PRICE_ZERO: Recommended Product ${p.productId} for Lead ${lead.id} has labelValue 0.`);
                }

                let name = '';
                const catalogDesc = productsById.get(String(p.productId))?.description;
                if (catalogDesc) {
                    name = catalogDesc;
                } else {
                    name = `Produto ${p.productId}`;
                    itemNameFallbackCount++;
                    log(`WARN_PRODUCT_NOT_FOUND: Recommended Product ${p.productId} for Lead ${lead.id} not found in Catalog.`);
                }

                return {
                    name: name,
                    qty: qty,
                    price: formatMoneyBR(rawPrice),
                    id: String(p.productId),
                    discAmt: formatMoneyBR(p.descountValue),
                    discType: normalizeDiscountType(p.descountType),
                    finalVal: formatMoneyBR(p.amount),
                    productIdForNameRes: p.productId
                };
            });

            itemsFromRecommended += itemsToExport.length;
        }

        const rawSourceValue = lead.source?.value;
        const origem = mapOrigemComercialReal(rawSourceValue);

        if (!origem) {
             log(`WARN_MISSING_SOURCE: Lead ${lead.id} has no source value.`);
        }

        if (!personId) leadsWithoutPerson++;
        if (!orgId) leadsWithoutOrg++;

        // Base Name Resolution for Deal
        let baseName = '';
        if (org) {
            baseName = org.name;
        } else if (mainPerson && mainPerson.name) {
            baseName = mainPerson.name;
        } else if (lead.lead) {
            baseName = lead.lead;
        } else {
             baseName = `Lead ${lead.id}`;
        }

        const firstTwo = getFirstTwoWords(baseName);

        // GENERATE ROWS
        if (itemsToExport.length > 0) {
            for (const item of itemsToExport) {
                const dealName = `${firstTwo} | ${item.name}`;

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
                    item.price,
                    item.id,
                    item.discAmt,
                    item.discType,
                    item.finalVal,
                    createdAt,
                    closedAt
                ]);
                lineItemsGenerated++;
            }
        } else {
            const dealName = baseName;

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
                '', '', '', '', '', '', '',
                createdAt,
                closedAt
            ]);
        }
        dealsGenerated++;
    }

    currentLog.totals.dealsGenerated = dealsGenerated;
    currentLog.totals.lineItemsGenerated = lineItemsGenerated;
    currentLog.discards.leadsWithoutOrg = leadsWithoutOrg;
    currentLog.discards.leadsWithoutPerson = leadsWithoutPerson;

    (currentLog.totals as any).itemsFromSold = itemsFromSold;
    (currentLog.totals as any).itemsFromRecommended = itemsFromRecommended;
    (currentLog.totals as any).itemNameFallbackCount = itemNameFallbackCount;

    const csvContent = generateCsvFromRows(headers, rows);
    return '\ufeff' + csvContent;
}
