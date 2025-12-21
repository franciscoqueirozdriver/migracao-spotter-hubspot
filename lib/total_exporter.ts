import { fetchAllSpotterOData } from './spotter';
import { buildCsv, sanitizeCsvValue } from './csv';

//region --- Tipos ---
export type LogCallback = (message: string) => void;

interface SpotterOrganization {
    id: number;
    name?: string;
    website?: string | null;
    webSite?: string | null;
    site?: string | null;
    cpfCnpj?: string;
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    zipCode?: string;
    city?: string;
    state?: string;
    country?: string;
}

interface SpotterLead {
    id: number;
    lead?: string; // Name of the lead
    stage?: { name?: string };
    organizationId?: number | null;
    website?: string | null;
    webSite?: string | null;
    cpfCnpj?: string | null;
    city?: string | null;
    state?: string | null;
    phone1?: string | null;
    registerDate?: string | null;
}

interface SpotterContact {
    id: number;
    name?: string;
    email?: string;
    phone?: string;
    organizationId?: number | null;
    registerDate?: string | null;
}

interface AuditStats {
    organizations_total: number;
    leads_total: number;
    contacts_total: number;
    leads_with_orgid: number;
    leads_missing_orgid: number;
    distinct_orgids_in_leads: number;
    orgids_in_leads_missing_in_orgs: number[];
    orgs_with_website: number;
    leads_with_website: number;
    orgs_without_website_but_lead_has_website: number[];
}
//endregion

//region --- Helpers ---
const getStringField = (obj: any, keys: string[]): string => {
    for (const key of keys) {
        if (typeof obj[key] === 'string' && obj[key].trim() !== '') {
            return obj[key].trim();
        }
    }
    return '';
};

const normalizeDomain = (url?: string | null) => {
    if (!url) return '';
    try {
        const fullUrl = url.startsWith('http') ? url : `https://${url}`;
        const domain = new URL(fullUrl).hostname;
        return domain.startsWith('www.') ? domain.slice(4) : domain;
    } catch { return url; }
};
//endregion

//region --- Export Functions ---
export async function exportTotalData(
    token: string,
    baseUrl: string,
    log: LogCallback,
    requestedEntity?: 'companies' | 'contacts' | 'leads'
): Promise<{ csvContent: string, logContent: string, fileName: string }> {

    log('Iniciando Exportação TOTAL (Baseline Mode)...');

    // 1. Fetch ALL Data
    log('1. Buscando TODAS as Organizações...');
    const allOrgs = await fetchAllSpotterOData<SpotterOrganization>(`${baseUrl}/v3/organization`, token, log);
    const orgsMap = new Map(allOrgs.map(o => [o.id, o]));

    log('2. Buscando TODOS os Leads...');
    const allLeads = await fetchAllSpotterOData<SpotterLead>(`${baseUrl}/v3/Leads`, token, log);

    log('3. Buscando TODOS os Contatos (Persons)...');
    // Assuming endpoint is /v3/Person based on typical Spotter structure.
    const allContacts = await fetchAllSpotterOData<SpotterContact>(`${baseUrl}/v3/Person`, token, log);

    // 2. Compute Audit
    log('Calculando auditoria cruzada...');

    const leadsWithOrgId = allLeads.filter(l => l.organizationId != null);
    const leadsMissingOrgId = allLeads.length - leadsWithOrgId.length;

    const distinctOrgIdsInLeads = new Set(leadsWithOrgId.map(l => l.organizationId!));

    const missingOrgIds: number[] = [];
    distinctOrgIdsInLeads.forEach(id => {
        if (!orgsMap.has(id)) missingOrgIds.push(id);
    });

    const orgsWithWebsite = allOrgs.filter(o => getStringField(o, ['website', 'webSite', 'site'])).length;
    const leadsWithWebsite = allLeads.filter(l => getStringField(l, ['website', 'webSite'])).length;

    const orgsWithoutWebsiteIds: number[] = [];
    allLeads.forEach(lead => {
        if (!lead.organizationId) return;
        const leadWebsite = getStringField(lead, ['website', 'webSite']);
        if (!leadWebsite) return;

        const org = orgsMap.get(lead.organizationId);
        if (org) {
            const orgWebsite = getStringField(org, ['website', 'webSite', 'site']);
            if (!orgWebsite) {
                if (orgsWithoutWebsiteIds.length < 20) orgsWithoutWebsiteIds.push(org.id);
            }
        }
    });

    const audit: AuditStats = {
        organizations_total: allOrgs.length,
        leads_total: allLeads.length,
        contacts_total: allContacts.length,
        leads_with_orgid: leadsWithOrgId.length,
        leads_missing_orgid: leadsMissingOrgId,
        distinct_orgids_in_leads: distinctOrgIdsInLeads.size,
        orgids_in_leads_missing_in_orgs: missingOrgIds.slice(0, 20),
        orgs_with_website: orgsWithWebsite,
        leads_with_website: leadsWithWebsite,
        orgs_without_website_but_lead_has_website: orgsWithoutWebsiteIds
    };

    const auditJson = JSON.stringify(audit, null, 2);
    log('--- Auditoria Final ---');
    log(auditJson);

    // 3. Generate Requested CSV
    // Default to audit report if no specific valid entity or if user wants just the baseline check
    let csvContent = auditJson;
    let fileName = 'audit_totals.json';

    if (requestedEntity === 'companies') {
        log('Gerando CSV: organizations_all.csv');
        const headers = ['Nome da empresa', 'Nome de domínio da empresa', 'CNPJ', 'Endereço', 'Número', 'Complemento', 'Bairro', 'Código postal', 'Cidade', 'Estado/Região', 'País/Região', 'spotter_organization_id'];

        const rows = allOrgs.map(org => {
            const website = getStringField(org, ['website', 'webSite', 'site']);
            return [
                sanitizeCsvValue(org.name),
                sanitizeCsvValue(normalizeDomain(website)),
                sanitizeCsvValue(org.cpfCnpj),
                sanitizeCsvValue(org.street),
                sanitizeCsvValue(org.number),
                sanitizeCsvValue(org.complement),
                sanitizeCsvValue(org.neighborhood),
                sanitizeCsvValue(org.zipCode),
                sanitizeCsvValue(org.city),
                sanitizeCsvValue(org.state),
                sanitizeCsvValue(org.country),
                sanitizeCsvValue(org.id)
            ];
        });

        csvContent = buildCsv(headers, rows);
        fileName = 'organizations_all.csv';

    } else if (requestedEntity === 'leads') { // Currently mapped to deals_line_items in FE usually, but we treat it as leads_all here
         log('Gerando CSV: leads_all.csv');
         const headers = ['id', 'lead', 'stage', 'organizationId', 'website', 'cpfCnpj', 'city', 'state', 'phone1', 'registerDate'];
         const rows = allLeads.map(lead => [
             sanitizeCsvValue(lead.id),
             sanitizeCsvValue(lead.lead),
             sanitizeCsvValue(lead.stage?.name),
             sanitizeCsvValue(lead.organizationId),
             sanitizeCsvValue(getStringField(lead, ['website', 'webSite'])),
             sanitizeCsvValue(lead.cpfCnpj),
             sanitizeCsvValue(lead.city),
             sanitizeCsvValue(lead.state),
             sanitizeCsvValue(lead.phone1),
             sanitizeCsvValue(lead.registerDate)
         ]);
         csvContent = buildCsv(headers, rows);
         fileName = 'leads_all.csv';

    } else if (requestedEntity === 'contacts') {
        log('Gerando CSV: contacts_all.csv');
        const headers = ['id', 'name', 'email', 'phone', 'organizationId', 'registerDate'];
        const rows = allContacts.map(c => [
            sanitizeCsvValue(c.id),
            sanitizeCsvValue(c.name),
            sanitizeCsvValue(c.email),
            sanitizeCsvValue(c.phone),
            sanitizeCsvValue(c.organizationId),
            sanitizeCsvValue(c.registerDate)
        ]);
        csvContent = buildCsv(headers, rows);
        fileName = 'contacts_all.csv';
    } else {
        log('Nenhuma entidade específica selecionada para download. Retornando Audit JSON.');
    }

    // Embed audit in log content as well just in case
    return {
        csvContent,
        logContent: `AUDIT REPORT:\n${auditJson}`,
        fileName
    };
}
//endregion
