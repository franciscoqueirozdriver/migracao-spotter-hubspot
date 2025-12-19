// lib/exporter.ts
import { fetchAllSpotterOData } from './spotter';
import { buildCsv, sanitizeCsvValue } from './csv';
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

if (HEADERS.COMPANIES.join(',') !== EXPECTED_HEADERS.COMPANIES) throw new Error("CRITICAL: Companies header mismatch!");
if (HEADERS.CONTACTS.join(',') !== EXPECTED_HEADERS.CONTACTS) throw new Error("CRITICAL: Contacts header mismatch!");
if (HEADERS.DEALS_LINE_ITEMS.join(',') !== EXPECTED_HEADERS.DEALS_LINE_ITEMS) throw new Error("CRITICAL: Deals header mismatch!");
//endregion

//region Type Definitions
export type LogCallback = (message: string) => void;
export type ExportMode = 'sold' | 'inProgress' | 'lost';
export type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items';
interface SpotterLeadSold { id: number; leadId: number; saleDate: string; products?: any[] }
interface SpotterLead { id: number; lead?: string; organizationId?: number | null; website?: string | null; cpfCnpj?: string; }
interface SpotterOrganization { id: number; name?: string; website?: string | null; cpfCnpj?: string; street?: string; number?: string; complement?: string; neighborhood?: string; zipCode?: string; city?: string; state?: string; country?: string; }
//endregion

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

  const allOrgs = await fetchOrganizations(token, baseUrl, log);
  const orgsMap = new Map(allOrgs.map(org => [org.id, org]));

  const normalizeCnpj = (v?: string) => (v ?? '').replace(/\D/g, '');
  const isPJ = (cnpjDigits: string) => cnpjDigits.length === 14;

  const companyKey = (lead: SpotterLead, org?: SpotterOrganization) => {
    const cnpj = normalizeCnpj(org?.cpfCnpj ?? lead?.cpfCnpj);
    if (org?.id) return `org:${org.id}`;
    if (isPJ(cnpj)) return `cnpj:${cnpj}`;
    return `lead:${lead.id}`;
  };

  const score = (lead: SpotterLead, org?: SpotterOrganization) => {
    let s = 0;
    const leadWebsite = (lead.website ?? '').trim();
    if (leadWebsite) s += 50;

    const cnpj = normalizeCnpj(org?.cpfCnpj ?? lead?.cpfCnpj);
    if (isPJ(cnpj)) s += 20;

    if ((org?.street ?? '').trim()) s += 5;
    if ((org?.city ?? '').trim()) s += 3;
    if ((org?.state ?? '').trim()) s += 2;

    return s;
  };

  const chosen = new Map<string, { lead: SpotterLead; org?: SpotterOrganization; s: number }>();

  let leadsMissing = 0;
  let websitesFromLead = 0;
  let websitesEmpty = 0;
  let duplicatesCollapsed = 0;

  soldLeadIds.forEach(leadId => {
    const lead = leadsMap.get(leadId);
    if (!lead) {
      leadsMissing++;
      log(`[LEAD_NOT_FOUND] Lead vendido (id=${leadId}) não foi encontrado em /v3/Leads. Descartado.`);
      return;
    }

    const leadWebsite = (lead.website ?? '').trim();
    if (leadWebsite) websitesFromLead++;
    else websitesEmpty++;

    const org = lead.organizationId ? orgsMap.get(lead.organizationId) : undefined;

    const key = companyKey(lead, org);
    const s = score(lead, org);

    const prev = chosen.get(key);
    if (!prev) {
      chosen.set(key, { lead, org, s });
    } else {
      duplicatesCollapsed++;
      if (s > prev.s) {
        chosen.set(key, { lead, org, s });
      } else if (s === prev.s) {
        const prevHasSite = !!(prev.lead.website ?? '').trim();
        const curHasSite = !!leadWebsite;
        if (curHasSite && !prevHasSite) chosen.set(key, { lead, org, s });
      }
    }
  });

  const rows: any[] = [];
  chosen.forEach(({ lead, org }) => {
    const websiteRaw = (lead.website ?? '').trim();
    const domain = normalizeDomain(websiteRaw);

    rows.push({
      'Nome da empresa': org?.name ?? lead.lead ?? '',
      'Nome de domínio da empresa': domain,
      'CNPJ': org?.cpfCnpj ?? lead?.cpfCnpj ?? '',
      'Endereço': org?.street ?? '',
      'Número': org?.number ?? '',
      'Complemento': org?.complement ?? '',
      'Bairro': org?.neighborhood ?? '',
      'Código postal': org?.zipCode ?? '',
      'Cidade': org?.city ?? '',
      'Estado/Região': org?.state ?? '',
      'País/Região': org?.country ?? '',
      'spotter_organization_id': org?.id ?? ''
    });
  });

  log(`--- Estatísticas de Geração de Empresas (Dedupe ON) ---`);
  log(`- Leads vendidos únicos: ${soldLeadIds.size}`);
  log(`- Empresas exportadas (após dedupe): ${rows.length}`);
  log(`- Leads não encontrados: ${leadsMissing}`);
  log(`- Duplicatas colapsadas: ${duplicatesCollapsed}`);
  log(`- Websites presentes no Lead: ${websitesFromLead}`);
  log(`- Websites vazios no Lead: ${websitesEmpty}`);
  log(`------------------------------------------------------`);

  const content = buildCsv(HEADERS.COMPANIES, rows.map(row => HEADERS.COMPANIES.map(h => sanitizeCsvValue(row[h]))));
  return { content, fileName: 'companies.csv' };
}

export async function exportDataForMode(
  mode: ExportMode,
  entities: ExportableEntity[],
  token: string,
  baseUrl: string
): Promise<{ fileContent: Buffer; fileName: string }> {
  const zip = new JSZip();
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const logMessages: string[] = [];
  const log: LogCallback = (message) => logMessages.push(`[${new Date().toISOString()}] ${message}`);

  log(`Iniciando exportação no modo: ${mode} para as entidades: ${entities.join(', ')}`);

  if (mode === 'sold') {
    if (entities.includes('companies')) {
        log('Gerando arquivo de empresas...');
        const { content: companiesCsv, fileName: companiesFileName } = await generateCompaniesCsv(token, baseUrl, log);
        zip.file(companiesFileName, companiesCsv);
        log(`Arquivo ${companiesFileName} adicionado ao zip.`);
    }
    if (entities.includes('contacts')) {
        log('AVISO: A exportação de contatos ainda não foi implementada.');
    }
    if (entities.includes('deals_line_items')) {
        log('AVISO: A exportação de negócios + itens de linha ainda não foi implementada.');
    }
  } else {
    const errorMessage = `O modo '${mode}' ainda não está implementado.`;
    log(`ERRO: ${errorMessage}`);
    throw new Error(errorMessage);
  }

  log('Gerando arquivo de log da execução...');
  const logContent = logMessages.join('\n');
  zip.file('run_log.txt', logContent);

  log('Compactando arquivos...');
  const fileContent = await zip.generateAsync({ type: 'nodebuffer' });
  const fileName = `spotter_export_${mode}_${runId}.zip`;
  log('Exportação concluída.');

  return { fileContent, fileName };
}
