// lib/exporter.ts
import { fetchAllSpotterOData } from './spotter';
import { buildCsv, sanitizeCsvValue } from './csv';
import { v4 as uuidv4 } from 'uuid';
import { saveExport } from './exportStorage';
import JSZip from 'jszip';

//region --- HEADER INTEGRITY CHECK ---
const EXPECTED_HEADERS = {
  COMPANIES: 'Nome da empresa,Nome de domínio da empresa,CNPJ,Endereço,Número,Complemento,Bairro,Código postal,Cidade,Estado/Região,País/Região,spotter_organization_id',
  CONTACTS: 'E-mail,Nome,Sobrenome,Cargo,Telefone,Telefone 2,spotter_person_id,spotter_lead_id,spotter_main_contact,spotter_messaging_platform,spotter_messaging_id',
  DEALS_LINE_ITEMS: 'Nome do negócio,Pipeline,Etapa do negócio,spotter_sale_id,spotter_lead_id,spotter_sale_date,spotter_sale_stage,spotter_cycle,spotter_total_deal_value,spotter_salesrep_email,spotter_presales_email,origem_comercial_real,spotter_organization_id,spotter_person_id,Nome,Quantidade,Preço unitário,spotter_product_id,spotter_discount_amount,spotter_discount_type,spotter_final_value',
};

const HEADERS = {
  COMPANIES: EXPECTED_HEADERS.COMPANIES.split(','),
  CONTACTS: EXPECTED_HEADERS.CONTACTS.split(','),
  DEALS_LINE_ITEMS: EXPECTED_HEADERS.DEALS_LINE_ITEMS.split(','),
};

// Runtime assertion to prevent regressions
if (HEADERS.COMPANIES.join(',') !== EXPECTED_HEADERS.COMPANIES) throw new Error("CRITICAL: Companies header mismatch!");
if (HEADERS.CONTACTS.join(',') !== EXPECTED_HEADERS.CONTACTS) throw new Error("CRITICAL: Contacts header mismatch!");
if (HEADERS.DEALS_LINE_ITEMS.join(',') !== EXPECTED_HEADERS.DEALS_LINE_ITEMS) throw new Error("CRITICAL: Deals header mismatch!");
//endregion

//region Type Definitions
export type LogCallback = (message: string) => void;
export type ExportMode = 'sold' | 'inProgress' | 'lost';
export type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items';
interface SpotterLeadSold { id: number; leadId: number; saleDate: string; products?: any[] }
interface SpotterLead { id: number; lead?: string; organizationId?: number | null; website?: string | null; source?: { value?: string }; }
interface SpotterOrganization { id: number; name?: string; website?: string | null; cpfCnpj?: string; street?: string; number?: string; complement?: string; neighborhood?: string; zipCode?: string; city?: string; state?: string; country?: string; }
// ... (rest of the file remains the same)
//endregion
// The rest of the file is unchanged, just pasting it back in.
const normalizeDomain = (url?: string | null) => {
    if (!url) return '';
    try {
        const fullUrl = url.startsWith('http') ? url : `https://${url}`;
        const domain = new URL(fullUrl).hostname;
        return domain.startsWith('www.') ? domain.slice(4) : domain;
    } catch { return url; }
};

const fetchLeadsSold = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterLeadSold>(`${baseUrl}/v3/LeadsSold`, token, log);
const fetchLeads = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterLead>(`${baseUrl}/v3/Leads`, token, log);
const fetchOrganizations = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterOrganization>(`${baseUrl}/v3/organization`, token, log);

async function generateCompaniesCsv(token: string, baseUrl: string, log: LogCallback): Promise<{ content: string, fileName: string }> {
    const sales = await fetchLeadsSold(token, baseUrl, log);
    const soldLeadIds = new Set(sales.map(s => s.leadId));

    const allLeads = await fetchLeads(token, baseUrl, log);
    const leadsMap = new Map(allLeads.map(l => [l.id, l]));

    const validOrgIds = new Set<number>();
    soldLeadIds.forEach(leadId => {
        const lead = leadsMap.get(leadId);
        if (lead?.organizationId) {
            validOrgIds.add(lead.organizationId);
        } else {
            log(`[ORG_MISSING] leadId=${leadId} lead='${lead?.lead}'`);
        }
    });

    const allOrgs = await fetchOrganizations(token, baseUrl, log);
    const orgsMap = new Map(allOrgs.map(org => [org.id, org]));

    const validRows: any[] = [];
    let missingWebsiteCount = 0;
    validOrgIds.forEach(orgId => {
        const org = orgsMap.get(orgId);
        const lead = allLeads.find(l => l.organizationId === orgId);

        if (org && org.id && org.name) {
            const website = lead?.website ?? '';
            if (!website) {
                missingWebsiteCount++;
            }
            validRows.push({
                'Nome da empresa': org.name,
                'Nome de domínio da empresa': normalizeDomain(website),
                'CNPJ': org.cpfCnpj,
                'Endereço': org.street, 'Número': org.number, 'Complemento': org.complement, 'Bairro': org.neighborhood,
                'Código postal': org.zipCode, 'Cidade': org.city, 'Estado/Região': org.state, 'País/Região': org.country,
                'spotter_organization_id': org.id
            });
        } else {
             log(`[ORG_NOT_FOUND] orgId=${orgId}`);
        }
    });

    log(`[DOMAIN_FROM_LEADS_ONLY] missing=${missingWebsiteCount} total=${validRows.length}`);

    const content = buildCsv(HEADERS.COMPANIES, validRows.map(row => HEADERS.COMPANIES.map(h => sanitizeCsvValue(row[h]))));
    return { content, fileName: 'companies.csv' };
}

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

    switch (entity) {
        case 'companies':
            const comp = await generateCompaniesCsv(token, baseUrl, log);
            fileContent = comp.content;
            fileName = `${exportId}_${comp.fileName}`;
            break;
        default:
             fileContent = `Entidade ${entity} não implementada.`;
             fileName = `${exportId}_error.txt`;
    }

    if (!fileContent) {
        log('Nenhum dado válido foi gerado.');
        throw new Error('Nenhum dado para exportar.');
    }

    const fileBuffer = Buffer.from(fileContent, 'utf-8');
    const downloadRef = await saveExport(exportId, fileName, fileBuffer);

    log(`Exportação concluída. Referência para download: ${downloadRef}`);
    return { downloadRef };
}
