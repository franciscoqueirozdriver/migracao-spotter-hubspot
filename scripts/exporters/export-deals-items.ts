
import path from 'path';
import fs from 'fs';
import { paginateOData } from '../../lib/exactSpotter/paginate';
import { generateCsvFromRows } from '../../lib/csv/writer';
import { SpotterLeadSold, SpotterLead, SpotterPerson } from '../../lib/deals'; // Reusing types/logic from lib/deals if possible or redefining

// Headers exatos solicitados:
// Nome do negócio,Pipeline,Etapa do negócio,spotter_sale_id,spotter_lead_id,spotter_sale_date,spotter_sale_stage,spotter_cycle,spotter_total_deal_value,spotter_salesrep_email,spotter_presales_email,origem_comercial_real,spotter_organization_id,spotter_person_id,Nome,Quantidade,Preço unitário,spotter_product_id,spotter_discount_amount,spotter_discount_type,spotter_final_value

// We need to fetch:
// 1. LeadsSold (for sales info and items)
// 2. Leads (for organizationId, source/origem)
// 3. Persons (for main contact personId)

// Helper functions (duplicated from lib/deals.ts or imported if refactored)
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

export async function runExportDealsAndItems(outputDir: string, token: string, baseUrl: string): Promise<void> {
    console.log('--- Starting Deals + Items Export (negocios_itens.csv) ---');

    // 1. Fetch LeadsSold (includes products)
    console.log('Fetching LeadsSold...');
    const leadsSold = await paginateOData<SpotterLeadSold>(baseUrl, '/v3/LeadsSold', token, console.log);
    console.log(`Fetched ${leadsSold.length} sold leads.`);

    // 2. Fetch Leads (needed for organizationId and Source)
    // Optimization: In a huge DB, fetching ALL leads just for sold ones might be slow.
    // Ideally we filter by IDs, but Spotter OData filter by list of IDs is tricky.
    // For now, following the "completeness" logic, we fetch all leads or we could rely on "LeadsSold" having what we need?
    // SpotterLeadSold interface doesn't have organizationId directly usually, it's on the Lead.
    // We will fetch ALL leads to ensure we have the data.
    console.log('Fetching All Leads (for enrichment)...');
    const allLeads = await paginateOData<SpotterLead>(baseUrl, '/v3/Leads', token, console.log);
    const leadsMap = new Map(allLeads.map(l => [l.id, l]));

    // 3. Fetch Persons (for main contact)
    console.log('Fetching Persons...');
    const allPersons = await paginateOData<SpotterPerson>(baseUrl, '/v3/Persons', token, console.log);

    // Map LeadID -> Main Person ID
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
        const main = persons.find((p: SpotterPerson) => p.mainContact) ?? persons[0];
        if (main) mainPersonIdByLeadId.set(leadId, main.id);
    }

    // Build Rows
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
        'Nome', // Line Item Name
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
        // If lead missing, we skip or log? Requirement says completeness.
        // We will skip if critical data missing but log if possible.
        if (!lead) continue;

        const products = sale.products ?? [];
        if (products.length === 0) continue; // Skip deals with no items if requirement implies "Line Items" presence

        const personId = mainPersonIdByLeadId.get(sale.leadId) ?? '';
        const orgId = lead.organizationId ?? '';
        const origem = mapOrigemComercialReal(lead.source?.value);

        // Deal Name logic: Company Name - Product? Or just Lead Name?
        // lib/deals.ts used: `${lead.lead ?? '(sem nome)'} - ${primaryProductName}`
        // We will stick to that logic or simplify. The header is "Nome do negócio".
        const primaryProduct = products[0];
        const primaryProductName = primaryProduct?.name ?? `Produto ${primaryProduct.id}`;
        const dealName = `${lead.lead ?? '(sem nome)'} - ${primaryProductName}`;

        for (const product of products) {
            rows.push([
                dealName,
                'default', // Pipeline
                'Vendido', // Etapa do negócio (Fixed)
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
    const filePath = path.join(outputDir, 'negocios_itens.csv');

    // Write with BOM
    fs.writeFileSync(filePath, '\ufeff' + csvContent);
    console.log(`Saved negocios_itens.csv to ${filePath}`);
}
