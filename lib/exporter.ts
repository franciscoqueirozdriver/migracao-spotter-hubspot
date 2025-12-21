// lib/exporter.ts
import { fetchAllSpotterOData } from './spotter';
import { buildCsv, sanitizeCsvValue } from './csv';
import { exportTotalData } from './total_exporter';

//region --- Tipos e Constantes ---
const EXPECTED_HEADERS = {
  COMPANIES: 'Nome da empresa,Nome de domínio da empresa,CNPJ,Endereço,Número,Complemento,Bairro,Código postal,Cidade,Estado/Região,País/Região,spotter_organization_id',
};

const HEADERS = {
  COMPANIES: EXPECTED_HEADERS.COMPANIES.split(','),
};

export type LogCallback = (message: string) => void;
// Added 'total' mode
export type ExportMode = 'sold' | 'inProgress' | 'lost' | 'total';
// Added 'leads' to exportable entities just in case, though route.ts needs update to accept it
export type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items' | 'leads';

interface SpotterLeadSold { leadId: number; }
interface SpotterLead { id: number; organizationId?: number | null; stage?: { name?: string }; website?: string | null; }
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
//endregion

//region --- Busca de Dados ---
const fetchLeadsSold = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterLeadSold>(`${baseUrl}/v3/LeadsSold`, token, log);
const fetchLeads = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterLead>(`${baseUrl}/v3/Leads`, token, log);
const fetchOrganizations = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterOrganization>(`${baseUrl}/v3/organization`, token, log);
//endregion

//region --- Geração de CSV de Empresas (Nova Lógica Estrutural) ---
async function generateCompaniesCsv(token: string, baseUrl: string, log: LogCallback): Promise<string> {
  // 1. Fonte da Verdade: LeadsSold
  log('Passo 1: Buscando todos os negócios fechados (LeadsSold)...');
  const sales = await fetchLeadsSold(token, baseUrl, log);
  const soldLeadIds = Array.from(new Set(sales.map(s => s.leadId)));
  log(`Total de LeadsSold encontrados: ${sales.length} (resultando em ${soldLeadIds.length} leads únicos)`);

  // 2. Mapeamento para Leads
  log('Passo 2: Buscando os detalhes dos leads vendidos...');
  const allLeads = await fetchLeads(token, baseUrl, log);
  const leadsMap = new Map(allLeads.map(l => [l.id, l]));
  log(`Total de leads encontrados na base: ${allLeads.length}`);

  let discardedLeadNotFound = 0;
  let discardedLeadIsDescartado = 0;
  let discardedLeadMissingOrgId = 0;
  // Mapa para garantir uma empresa por organizationId, mantendo referência ao lead
  const validLeadsByOrgId = new Map<number, SpotterLead>();

  soldLeadIds.forEach(leadId => {
    const lead = leadsMap.get(leadId);
    if (!lead) {
      discardedLeadNotFound++;
      return;
    }
    if (lead.stage?.name === 'Descartado') {
      discardedLeadIsDescartado++;
      return;
    }
    if (!lead.organizationId) {
      discardedLeadMissingOrgId++;
      return;
    }
    // Adiciona ao mapa apenas se a organização ainda não foi processada
    if (!validLeadsByOrgId.has(lead.organizationId)) {
      validLeadsByOrgId.set(lead.organizationId, lead);
    }
  });
  log(`Total de organizações únicas a serem buscadas: ${validLeadsByOrgId.size}`);

  // 3. Busca das Organizações Finais
  log('Passo 3: Buscando os dados das organizações finais...');
  const allOrgs = await fetchOrganizations(token, baseUrl, log);
  const orgsMap = new Map(allOrgs.map(org => [org.id, org]));
  log(`Total de organizações encontradas na base: ${allOrgs.length}`);

  const rows: Record<string, any>[] = [];
  let discardedOrgNotFound = 0;

  validLeadsByOrgId.forEach(lead => {
    const org = orgsMap.get(lead.organizationId!);
    if (org) {
      rows.push({
        'Nome da empresa': org.name,
        'Nome de domínio da empresa': normalizeDomain(lead.website), // Correção: usa o website do Lead
        'CNPJ': org.cpfCnpj,
        'Endereço': org.street,
        'Número': org.number,
        'Complemento': org.complement,
        'Bairro': org.neighborhood,
        'Código postal': org.zipCode,
        'Cidade': org.city,
        'Estado/Região': org.state,
        'País/Região': org.country,
        'spotter_organization_id': org.id
      });
    } else {
      discardedOrgNotFound++;
    }
  });
  log(`Total de empresas únicas exportadas: ${rows.length}`);

  // Logs de Auditoria Finais
  log('--- Auditoria da Execução ---');
  log(`- Total de LeadsSold processados: ${sales.length}`);
  log(`- Descartados (Lead inexistente): ${discardedLeadNotFound}`);
  log(`- Descartados (Lead com stage 'Descartado'): ${discardedLeadIsDescartado}`);
  log(`- Descartados (organizationId ausente): ${discardedLeadMissingOrgId}`);
  log(`- Descartados (Organization não encontrada): ${discardedOrgNotFound}`);
  log(`- Total de empresas únicas no CSV: ${rows.length}`);
  log('-----------------------------');

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
  let fileName = 'export.csv';
  let logContent = '';

  if (mode === 'total') {
      // Map existing entities to "Total" requested entities
      // companies -> companies
      // contacts -> contacts
      // deals_line_items -> leads (since deals_line_items implies leads/sales, we map it to leads_all)
      let requestedEntity: 'companies' | 'contacts' | 'leads' | undefined;

      if (entities.includes('companies')) requestedEntity = 'companies';
      else if (entities.includes('contacts')) requestedEntity = 'contacts';
      else if (entities.includes('deals_line_items') || entities.includes('leads')) requestedEntity = 'leads';

      const result = await exportTotalData(token, baseUrl, log, requestedEntity);
      csvContent = result.csvContent;
      fileName = result.fileName;
      // Combine logs
      logMessages.push(`\n--- Logs do Baseline ---\n${result.logContent}`);
  }
  else if (mode === 'sold') {
    if (entities.includes('companies')) {
        log('Gerando arquivo de empresas...');
        csvContent = await generateCompaniesCsv(token, baseUrl, log);
        fileName = `empresas_vendas_concluidas_${new Date().toISOString().split('T')[0]}.csv`;
        log(`Arquivo de empresas gerado.`);
    } else {
      log(`AVISO: A entidade '${entities.join(', ')}' não está implementada.`);
      csvContent = 'Entidade não implementada.';
    }
  } else {
    const errorMessage = `O modo '${mode}' ainda não está implementado.`;
    log(`ERRO: ${errorMessage}`);
    throw new Error(errorMessage);
  }

  logContent = logMessages.join('\n');
  log('Exportação concluída.');

  return { csvContent, logContent, fileName };
}
//endregion
