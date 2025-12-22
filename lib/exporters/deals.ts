
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
    name?: string; // Added to support person name resolution
}

interface SpotterOrg {
    id: number;
    name: string;
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

function getFirstTwoWords(name?: string | null): string {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    return parts.slice(0, 2).join(' ');
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
    const recommended = await paginateOData<RecommendedProduct>(baseUrl, '/v3/recommendedProducts', token, log);
    (currentLog.totals as any).recommendedFetched = recommended.length;

    const recommendedMap = new Map<number, RecommendedProduct[]>();
    for (const rp of recommended) {
        const list = recommendedMap.get(rp.leadId) ?? [];
        list.push(rp);
        recommendedMap.set(rp.leadId, list);
    }
    log(`Fetched ${recommended.length} recommended products.`);

    // NEW: Fetch Product Catalog
    log('Fetching Product Catalog...');
    const products = await paginateOData<SpotterProduct>(baseUrl, '/v3/products', token, log);
    (currentLog.totals as any).productsCatalogFetched = products.length;
    const productsById = new Map(products.map(p => [p.id, p]));
    log(`Fetched ${products.length} catalog products.`);

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

    // NEW: Fetch Organizations to get Company Name
    log('Fetching Organizations...');
    const allOrgs = await paginateOData<SpotterOrg>(baseUrl, '/v3/organization', token, log);
    const orgsById = new Map(allOrgs.map(o => [o.id, o]));
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
        'Produto', // Renamed from 'Nome'
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
    let itemsFromSold = 0;
    let itemsFromRecommended = 0;
    let itemNameFallbackCount = 0;

    for (const lead of allLeads) {
        const soldData = soldMap.get(lead.id);
        const lostData = lostMap.get(lead.id);
        const recommendedData = recommendedMap.get(lead.id) ?? [];
        const personId = mainPersonIdByLeadId.get(lead.id);
        const orgId = lead.organizationId;
        const org = orgId ? orgsById.get(orgId) : undefined;
        const mainPerson = personId ? personsByLead.get(lead.id)?.find(p => p.id === personId) : undefined;

        let stage = '';
        let saleId = '';
        let saleDate = '';
        let saleStage = '';
        let cycle = '';
        let totalValue = '0';
        let salesRepEmail = '';
        let preSalesEmail = '';

        interface LineItem {
            name: string;
            qty: number;
            price: number;
            id: string;
            discAmt: number;
            discType: string;
            finalVal: number;
            productIdForNameRes?: number;
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

            itemsToExport = (soldData.products ?? []).map(p => {
                // Name resolution: check catalog first using ID
                let name = '';
                const catalogDesc = productsById.get(p.id)?.description;
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
                    price: p.individualValue ?? 0,
                    id: String(p.id),
                    discAmt: p.discountAmount ?? 0,
                    discType: normalizeDiscountType(p.discountType),
                    finalVal: p.finalValue ?? 0,
                    productIdForNameRes: p.id
                };
            });

            itemsFromSold += itemsToExport.length;

        } else if (lostData) {
            // Case 2: Lost
            stage = lostData.stage ?? '';
            if (!stage) {
                log(`WARNING: Lost Lead ${lead.id} has no stage. Using empty string.`);
            }

            saleDate = formatDateBR(lostData.date);
            itemsToExport = [];

        } else {
            // Case 3: Open
            const extractedStage = getLeadStageName(lead);
            if (extractedStage) {
                stage = extractedStage;
            } else {
                stage = '';
                log(`WARNING: Open Lead ${lead.id} has no stage name. Using empty string.`);
            }

            itemsToExport = recommendedData.map(p => {
                const qty = p.quantity ?? 1;
                // STRICT: Use labelValue. Log if 0.
                const price = p.labelValue ?? 0;
                if (price === 0) {
                     log(`WARN_UNIT_PRICE_ZERO: Recommended Product ${p.productId} for Lead ${lead.id} has labelValue 0.`);
                }

                // Name resolution
                let name = '';
                const catalogDesc = productsById.get(p.productId)?.description;
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
                    price: price,
                    id: String(p.productId),
                    discAmt: p.descountValue ?? 0,
                    discType: normalizeDiscountType(p.descountType),
                    finalVal: p.amount ?? 0,
                    productIdForNameRes: p.productId
                };
            });

            itemsFromRecommended += itemsToExport.length;
        }

        const origem = mapOrigemComercialReal(lead.source ?? undefined);

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
                // Deal Name Logic: "<2 words> | <Item Name>"
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
                    String(item.price),
                    item.id,
                    String(item.discAmt),
                    item.discType,
                    String(item.finalVal)
                ]);
                lineItemsGenerated++;
            }
        } else {
            // 1 row, empty items. Fallback dealname?
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
                '', '', '', '', '', '', ''
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
