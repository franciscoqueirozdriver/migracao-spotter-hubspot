
import { paginateOData } from '../exactSpotter/paginate';
import { generateCsvFromRows } from '../csv/writer';
import { LogCallback } from '../exporter';

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
}

interface SpotterPerson {
    id: number;
    leadId?: number | null;
    mainContact?: boolean | null;
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
    const normalized = sourceValue.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    if (normalized.includes('prospeccao ativa') || normalized.includes('outbound')) return 'Outbound';
    if (normalized.includes('carteira de clientes') || normalized.includes('base') || normalized.includes('white space')) return 'White Space (Base)';
    if (normalized.includes('indicacao') || normalized.includes('programa')) return 'Base Viral (Programa de Indicação)';
    if (normalized.includes('parceiros') || normalized.includes('partner')) return 'Parceiros';

    return 'Inbound';
}

function normalizeDiscountType(type?: string): string {
    if (!type) return 'Nenhum';
    const lowerType = type.toLowerCase();
    if (lowerType.includes('absoluto')) return 'Absoluto';
    if (lowerType.includes('percentual')) return 'Porcentual';
    return type;
}

export async function generateDealsItemsCsvStrict(token: string, baseUrl: string, log: LogCallback): Promise<string> {
    log('--- Starting Deals + Items Export (negocios_itens.csv) ---');

    // 1. Fetch LeadsSold
    log('Fetching LeadsSold...');
    const leadsSold = await paginateOData<SpotterLeadSold>(baseUrl, '/v3/LeadsSold', token, log);
    log(`Fetched ${leadsSold.length} sold leads.`);

    // 2. Fetch All Leads (for enrichment)
    log('Fetching All Leads...');
    const allLeads = await paginateOData<SpotterLead>(baseUrl, '/v3/Leads', token, log);
    const leadsMap = new Map(allLeads.map(l => [l.id, l]));

    // 3. Fetch Persons
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

    for (const sale of leadsSold) {
        const lead = leadsMap.get(sale.leadId);
        if (!lead) continue;

        const products = sale.products ?? [];
        if (products.length === 0) continue;

        const personId = mainPersonIdByLeadId.get(sale.leadId) ?? '';
        const orgId = lead.organizationId ?? '';
        const origem = mapOrigemComercialReal(lead.source ?? undefined);

        const primaryProduct = products[0];
        const primaryProductName = primaryProduct?.name ?? `Produto ${primaryProduct.id}`;
        const dealName = `${lead.lead ?? '(sem nome)'} - ${primaryProductName}`;

        for (const product of products) {
            rows.push([
                dealName,
                'default',
                'Vendido',
                String(sale.id),
                String(sale.leadId),
                formatDateBR(sale.saleDate),
                sale.saleStage ?? '',
                String(sale.cycle ?? ''),
                String(sale.totalDealValue ?? 0),
                sale.salesRep?.email ?? '',
                sale.preSales?.email ?? '',
                origem,
                String(orgId),
                String(personId),
                product.name ?? '',
                String(product.quantity ?? 1),
                String(product.individualValue ?? 0),
                String(product.id),
                String(product.discountAmount ?? 0),
                normalizeDiscountType(product.discountType),
                String(product.finalValue ?? 0)
            ]);
        }
    }

    const csvContent = generateCsvFromRows(headers, rows);
    return '\ufeff' + csvContent;
}
