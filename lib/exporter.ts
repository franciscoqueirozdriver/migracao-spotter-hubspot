// lib/exporter.ts
import { fetchAllSpotterOData } from './spotter';
import { buildCsv, sanitizeCsvValue } from './csv';
import { v4 as uuidv4 } from 'uuid';
import { saveExport } from './exportStorage';
import JSZip from 'jszip';

//region Type Definitions
export type LogCallback = (message: string) => void;
export type ExportMode = 'sold' | 'inProgress' | 'lost';
export type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items';

// Spotter API Interfaces
interface SpotterLeadSold { id: number; leadId: number; saleDate: string; products?: SpotterProduct[] }
interface SpotterProduct { id: number; name?: string; quantity?: number; individualValue?: number; }
interface SpotterLead { id: number; lead?: string; organizationId?: number; website?: string; source?: { value?: string }; }
interface SpotterOrganization { id: number; name?: string; website?: string; cpfCnpj?: string; street?: string; number?: string; complement?: string; neighborhood?: string; zipCode?: string; city?: string; state?: string; country?: string; }
interface SpotterPerson { id: number; name?: string; leadId?: number; mainContact?: boolean; role?: string; emails?: { address?: string }[]; phones?: { number?: string }[]; social?: { platform?: string; id?: string }[]; }
//endregion

//region --- HEADERS (ABSOLUTE RULE) ---
const HEADERS = {
  COMPANIES: ['Nome da empresa', 'Nome de domínio da empresa', 'CNPJ', 'Endereço', 'Número', 'Complemento', 'Bairro', 'Código postal', 'Cidade', 'Estado/Região', 'País/Região', 'spotter_organization_id'],
  CONTACTS: ['E-mail', 'Nome', 'Sobrenome', 'Cargo', 'Telefone', 'Telefone 2', 'spotter_person_id', 'spotter_lead_id', 'spotter_main_contact', 'spotter_messaging_platform', 'spotter_messaging_id'],
  DEALS_LINE_ITEMS: ['Nome do negócio', 'Pipeline', 'Etapa do negócio', 'spotter_sale_id', 'spotter_lead_id', 'spotter_sale_date', 'spotter_sale_stage', 'spotter_cycle', 'spotter_total_deal_value', 'spotter_salesrep_email', 'spotter_presales_email', 'origem_comercial_real', 'spotter_organization_id', 'spotter_person_id', 'Nome', 'Quantidade', 'Preço unitário', 'spotter_product_id', 'spotter_discount_amount', 'spotter_discount_type', 'spotter_final_value'],
};
//endregion

//region --- UTILITY & HELPER FUNCTIONS ---
const formatDate = (iso?: string) => iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '';
const normalizeDomain = (url?: string) => {
    if (!url) return '';
    try {
        const fullUrl = url.startsWith('http') ? url : `https://${url}`;
        const domain = new URL(fullUrl).hostname;
        return domain.startsWith('www.') ? domain.slice(4) : domain;
    } catch { return url; }
};
const splitName = (name = '') => {
    const parts = name.trim().split(/\s+/);
    return { firstName: parts.shift() || '', lastName: parts.join(' ') || '-' };
};
//endregion

//region --- DATA FETCHING ---
const fetchLeadsSold = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterLeadSold>(`${baseUrl}/v3/LeadsSold`, token, log);
const fetchLeads = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterLead>(`${baseUrl}/v3/Leads`, token, log);
const fetchOrganizations = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterOrganization>(`${baseUrl}/v3/organization`, token, log);
const fetchPersons = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterPerson>(`${baseUrl}/v3/Persons/`, token, log);
//endregion

//region --- CSV GENERATION LOGIC ---

// A) Companies
async function generateCompaniesCsv(token: string, baseUrl: string, log: LogCallback): Promise<string> {
    const sales = await fetchLeadsSold(token, baseUrl, log);
    const soldLeadIds = new Set(sales.map(s => s.leadId));

    const allLeads = await fetchLeads(token, baseUrl, log);
    const leadsMap = new Map(allLeads.map(l => [l.id, l]));

    // Create a fallback map for organization websites from leads
    const orgWebsiteFallback = new Map<number, string>();
    for (const lead of allLeads) {
        if (lead.organizationId && lead.website && !orgWebsiteFallback.has(lead.organizationId)) {
            orgWebsiteFallback.set(lead.organizationId, lead.website);
        }
    }

    const validOrgIds = new Set<number>();
    soldLeadIds.forEach(leadId => {
        const lead = leadsMap.get(leadId);
        if (lead?.organizationId) validOrgIds.add(lead.organizationId);
    });

    const allOrgs = await fetchOrganizations(token, baseUrl, log);
    const orgsMap = new Map(allOrgs.map(org => [org.id, org]));

    const validRows: any[] = [];
    validOrgIds.forEach(orgId => {
        const org = orgsMap.get(orgId);
        if (org && org.id && org.name) {
            const websiteRaw = org.website || orgWebsiteFallback.get(org.id) || '';

            if (org.name?.toLowerCase().includes('calsimec')) {
                log(`[VERIFICATION] CALSIMEC | Org Website: '${org.website}' | Fallback Website: '${orgWebsiteFallback.get(org.id)}' | Raw used: '${websiteRaw}' | Normalized: '${normalizeDomain(websiteRaw)}'`);
            }

            validRows.push({
                'Nome da empresa': org.name,
                'Nome de domínio da empresa': normalizeDomain(websiteRaw),
                'CNPJ': org.cpfCnpj,
                'Endereço': org.street, 'Número': org.number, 'Complemento': org.complement, 'Bairro': org.neighborhood,
                'Código postal': org.zipCode, 'Cidade': org.city, 'Estado/Região': org.state, 'País/Região': org.country,
                'spotter_organization_id': org.id
            });
        }
    });

    return buildCsv(HEADERS.COMPANIES, validRows.map(row => HEADERS.COMPANIES.map(h => sanitizeCsvValue(row[h]))));
}
// (The rest of the file remains unchanged)
// ...
//endregion

//region --- MAIN ORCHESTRATOR ---
export async function exportDataForMode(
  mode: ExportMode,
  entity: ExportableEntity,
  token: string,
  baseUrl: string,
  log: LogCallback
): Promise<{ downloadRef: string }> {
    const exportId = uuidv4();
    let fileContent: string = '';
    let fileName: string = '';

    if (mode !== 'sold') {
        throw new Error(`O modo '${mode}' ainda não está implementado.`);
    }

    // This is a simplified version for the fix, the full version would have the other entities
    switch (entity) {
        case 'companies':
            fileContent = await generateCompaniesCsv(token, baseUrl, log);
            fileName = `${exportId}_companies.csv`;
            break;
        default:
             fileContent = `Entity ${entity} not implemented in this simplified fix.`;
             fileName = `${exportId}_error.txt`;
    }

    if (!fileContent) {
        log('Nenhum dado válido foi gerado. O arquivo estará vazio.');
        // Return an empty file with headers
        const headers = (HEADERS as any)[entity.toUpperCase()] ?? [];
        fileContent = buildCsv(headers, []);
    }

    const fileBuffer = Buffer.from(fileContent, 'utf-8');
    const downloadRef = await saveExport(exportId, fileName, fileBuffer);

    log(`Exportação concluída. Referência para download: ${downloadRef}`);
    return { downloadRef };
}
//endregion
