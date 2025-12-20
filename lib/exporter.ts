// lib/exporter.ts
import { fetchAllSpotterOData } from './spotter';
import { buildCsv, sanitizeCsvValue } from './csv';

//region --- Tipos e Constantes ---
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

export type LogCallback = (message: string) => void;
export type ExportMode = 'sold' | 'inProgress' | 'lost';
export type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items';
interface SpotterLeadSold { id: number; leadId: number; }
interface SpotterLead { id: number; lead?: string; organizationId?: number | null; website?: string | null; cpfCnpj?: string; }
interface SpotterOrganization { id: number; name?: string; website?: string | null; cpfCnpj?: string; street?: string; number?: string; complement?: string; neighborhood?: string; zipCode?: string; city?: string; state?: string; country?: string; }
//endregion

//region --- Funções de Apoio ---
const normalizeDomain = (url?: string | null) => {
    if (!url) return '';
    try {
        const fullUrl = url.startsWith('http') ? url : `https://${url}`;
        const domain = new URL(fullUrl).hostname;
        return domain.startsWith('www.') ? domain.slice(4) : domain;
    } catch { return url; }
};

const normalizeName = (name?: string) => (name ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
//endregion

//region --- Busca de Dados ---
const fetchLeadsSold = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterLeadSold>(`${baseUrl}/v3/LeadsSold`, token, log);
const fetchLeads = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterLead>(`${baseUrl}/v3/Leads`, token, log);
const fetchOrganizations = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterOrganization>(`${baseUrl}/v3/organization`, token, log);
//endregion

//region --- Geração de CSV de Empresas (Lógica Principal) ---
async function generateCompaniesCsv(token: string, baseUrl: string, log: LogCallback): Promise<string> {
  const sales = await fetchLeadsSold(token, baseUrl, log);
  const soldLeadIds = new Set(sales.map(s => s.leadId));

  const allLeads = await fetchLeads(token, baseUrl, log);
  const leadsMap = new Map(allLeads.map(l => [l.id, l]));

  const allOrgs = await fetchOrganizations(token, baseUrl, log);
  const orgsMap = new Map(allOrgs.map(org => [org.id, org]));

  //region --- Lógica de Deduplicação e Pontuação ---
  const normalizeCnpj = (v?: string) => (v ?? '').replace(/\D/g, '');
  const isPJ = (cnpjDigits: string) => cnpjDigits.length === 14;

  const companyKey = (lead: SpotterLead, org?: SpotterOrganization) => {
    const orgName = org?.name;
    const leadName = lead.lead;
    const cnpj = normalizeCnpj(org?.cpfCnpj ?? lead?.cpfCnpj);
    const normalizedCompanyName = normalizeName(orgName ?? leadName);

    if (org?.id) return `org:${org.id}`;
    if (isPJ(cnpj)) return `cnpj:${cnpj}`;
    if (normalizedCompanyName) return `name:${normalizedCompanyName}`;
    return `lead:${lead.id}`; // Último recurso
  };

  const score = (lead: SpotterLead, org?: SpotterOrganization) => {
    let s = 0;
    if ((lead.website ?? '').trim()) s += 50;
    if (isPJ(normalizeCnpj(org?.cpfCnpj ?? lead?.cpfCnpj))) s += 20;
    if ((org?.street ?? '').trim()) s += 5;
    if ((org?.city ?? '').trim()) s += 3;
    if ((org?.state ?? '').trim()) s += 2;
    return s;
  };

  const chosen = new Map<string, { lead: SpotterLead; org?: SpotterOrganization; s: number }>();
  //endregion

  //region --- Estatísticas e Processamento ---
  let leadsMissing = 0, websitesFromLead = 0, websitesEmpty = 0, duplicatesCollapsed = 0;

  soldLeadIds.forEach(leadId => {
    const lead = leadsMap.get(leadId);
    if (!lead) {
      leadsMissing++;
      log(`[LEAD_NOT_FOUND] Lead vendido (id=${leadId}) não foi encontrado. Descartado.`);
      return;
    }
    if ((lead.website ?? '').trim()) websitesFromLead++; else websitesEmpty++;

    const org = lead.organizationId ? orgsMap.get(lead.organizationId) : undefined;
    const key = companyKey(lead, org);
    const s = score(lead, org);
    const prev = chosen.get(key);

    if (!prev || s > prev.s || (s === prev.s && !!(lead.website ?? '').trim() && !prev.lead.website)) {
      if (prev) duplicatesCollapsed++;
      chosen.set(key, { lead, org, s });
    } else {
      duplicatesCollapsed++;
    }
  });
  //endregion

  //region --- Montagem das Linhas Finais ---
  const rows: any[] = [];
  chosen.forEach(({ lead, org }) => {
    rows.push({
      'Nome da empresa': org?.name ?? lead.lead ?? '',
      'Nome de domínio da empresa': normalizeDomain(lead.website),
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
  //endregion

  //region --- Logs Finais ---
  log(`--- Estatísticas de Geração de Empresas (Dedupe Aprimorado) ---`);
  log(`- Leads vendidos únicos: ${soldLeadIds.size}`);
  log(`- Empresas exportadas (após dedupe): ${rows.length}`);
  log(`- Leads não encontrados: ${leadsMissing}`);
  log(`- Duplicatas colapsadas: ${duplicatesCollapsed}`);
  log(`- Websites presentes no Lead: ${websitesFromLead}`);
  log(`- Websites vazios no Lead: ${websitesEmpty}`);
  log(`------------------------------------------------------`);
  //endregion

  return buildCsv(HEADERS.COMPANIES, rows.map(row => HEADERS.COMPANIES.map(h => sanitizeCsvValue(row[h]))));
}
//endregion

//region --- Função de Exportação Principal ---
export async function exportDataForMode(
  mode: ExportMode,
  entities: ExportableEntity[],
  token: string,
  baseUrl: string
): Promise<{ csvContent: string, logContent: string, fileName: string }> {
  const logMessages: string[] = [];
  const log: LogCallback = (message) => logMessages.push(`[${new Date().toISOString()}] ${message}`);

  log(`Iniciando exportação no modo: ${mode} para as entidades: ${entities.join(', ')}`);

  let csvContent = '';
  let fileName = 'export.csv'; // Default filename

  if (mode === 'sold') {
    if (entities.includes('companies')) {
        log('Gerando arquivo de empresas...');
        csvContent = await generateCompaniesCsv(token, baseUrl, log);
        fileName = `empresas_${new Date().toISOString().split('T')[0]}.csv`;
        log(`Arquivo de empresas gerado com ${csvContent.split('\n').length - 1} registros.`);
    } else {
      // Futuramente, outras entidades seriam tratadas aqui
      log(`AVISO: A entidade '${entities.join(', ')}' não está implementada para geração de CSV único.`);
      csvContent = 'Nenhuma entidade válida selecionada para exportação.';
    }
  } else {
    const errorMessage = `O modo '${mode}' ainda não está implementado.`;
    log(`ERRO: ${errorMessage}`);
    throw new Error(errorMessage);
  }

  const logContent = logMessages.join('\n');
  log('Exportação concluída.');

  return { csvContent, logContent, fileName };
}
//endregion
