// lib/exporter.ts
import { fetchAllSpotterOData } from './spotter';
import { buildCsv, sanitizeCsvValue } from './csv';

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
const normalizeDomain = (url?: string) => {
    if (!url) return '';
    try {
        const domain = new URL(url).hostname;
        return domain.startsWith('www.') ? domain.slice(4) : domain;
    } catch { return url; }
};
const splitName = (name = '') => {
    const parts = name.trim().split(/\s+/);
    return { firstName: parts.shift() || '', lastName: parts.join(' ') || '-' };
};
const noOpLog: LogCallback = () => {};
//endregion

//region --- DATA FETCHING ---
const fetchLeadsSold = (token: string, baseUrl: string) => fetchAllSpotterOData<SpotterLeadSold>(`${baseUrl}/v3/LeadsSold`, token, noOpLog);
const fetchLeads = (token: string, baseUrl: string) => fetchAllSpotterOData<SpotterLead>(`${baseUrl}/v3/Leads`, token, noOpLog);
const fetchOrganizations = (token: string, baseUrl: string) => fetchAllSpotterOData<SpotterOrganization>(`${baseUrl}/v3/organization`, token, noOpLog);
const fetchPersons = (token: string, baseUrl: string) => fetchAllSpotterOData<SpotterPerson>(`${baseUrl}/v3/Persons/`, token, noOpLog);
//endregion

//region --- CSV GENERATION LOGIC ---

// A) Companies
async function generateCompaniesCsv(token: string, baseUrl: string): Promise<string> {
    const sales = await fetchLeadsSold(token, baseUrl);
    const soldLeadIds = new Set(sales.map(s => s.leadId));

    const allLeads = await fetchLeads(token, baseUrl);
    const leadsMap = new Map(allLeads.map(l => [l.id, l]));

    const validOrgIds = new Set<number>();
    soldLeadIds.forEach(leadId => {
        const lead = leadsMap.get(leadId);
        if (lead?.organizationId) {
            validOrgIds.add(lead.organizationId);
        }
    });

    const allOrgs = await fetchOrganizations(token, baseUrl);
    const orgsMap = new Map(allOrgs.map(org => [org.id, org]));

    const validRows: any[] = [];
    validOrgIds.forEach(orgId => {
        const org = orgsMap.get(orgId);
        if (org && org.id && org.name) {
             validRows.push({
                'Nome da empresa': org.name, 'Nome de domínio da empresa': normalizeDomain(org.website), 'CNPJ': org.cpfCnpj,
                'Endereço': org.street, 'Número': org.number, 'Complemento': org.complement, 'Bairro': org.neighborhood,
                'Código postal': org.zipCode, 'Cidade': org.city, 'Estado/Região': org.state, 'País/Região': org.country,
                'spotter_organization_id': org.id
            });
        }
    });

    return buildCsv(HEADERS.COMPANIES, validRows.map(row => HEADERS.COMPANIES.map(h => sanitizeCsvValue(row[h]))));
}

// B) Contacts
async function generateContactsCsv(token: string, baseUrl: string): Promise<string> {
    const sales = await fetchLeadsSold(token, baseUrl);
    const soldLeadIds = new Set(sales.map(s => s.leadId));

    const allPersons = await fetchPersons(token, baseUrl);
    const soldPersons = allPersons.filter(p => p.leadId && soldLeadIds.has(p.leadId));

    const validRows: any[] = [];
    soldPersons.forEach(person => {
        if (person.id && person.leadId) {
            const { firstName, lastName } = splitName(person.name);
            validRows.push({
                'E-mail': person.emails?.[0]?.address, 'Nome': firstName, 'Sobrenome': lastName, 'Cargo': person.role,
                'Telefone': person.phones?.[0]?.number, 'Telefone 2': person.phones?.[1]?.number,
                'spotter_person_id': person.id, 'spotter_lead_id': person.leadId,
                'spotter_main_contact': person.mainContact,
                'spotter_messaging_platform': person.social?.[0]?.platform, 'spotter_messaging_id': person.social?.[0]?.id,
            });
        }
    });

    return buildCsv(HEADERS.CONTACTS, validRows.map(row => HEADERS.CONTACTS.map(h => sanitizeCsvValue(row[h]))));
}
//endregion

//region --- MAIN ORCHESTRATOR ---
export async function exportDataForMode(
  mode: ExportMode,
  entity: ExportableEntity,
  token: string,
  baseUrl: string,
): Promise<{fileName: string, content: string}> {

    if (mode !== 'sold') {
        throw new Error(`O modo '${mode}' ainda não está implementado.`);
    }

    switch (entity) {
        case 'companies':
            const companiesCsv = await generateCompaniesCsv(token, baseUrl);
            return { fileName: 'companies.csv', content: companiesCsv };
        case 'contacts':
            const contactsCsv = await generateContactsCsv(token, baseUrl);
            return { fileName: 'contacts.csv', content: contactsCsv };
        case 'deals_line_items':
             throw new Error(`A exportação de '${entity}' ainda não foi implementada neste fluxo.`);
        default:
            throw new Error(`Entidade desconhecida: ${entity}`);
    }
}
//endregion
