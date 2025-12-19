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
interface SpotterLeadSold { id: number; leadId: number; saleDate: string; products?: any[] }
interface SpotterLead { id: number; lead?: string; organizationId?: number | null; website?: string | null; source?: { value?: string }; }
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
    log('Buscando vendas (LeadsSold)...');
    const sales = await fetchLeadsSold(token, baseUrl, log);
    const soldLeadIds = new Set(sales.map(s => s.leadId));
    log(`Total de ${sales.length} vendas encontradas.`);

    log('Buscando todos os leads para mapeamento...');
    const allLeads = await fetchLeads(token, baseUrl, log);
    const leadsMap = new Map(allLeads.map(l => [l.id, l]));
    log(`Total de ${allLeads.length} leads encontrados.`);

    const validOrgIds = new Set<number>();
    soldLeadIds.forEach(leadId => {
        const lead = leadsMap.get(leadId);
        if (lead?.organizationId) {
            validOrgIds.add(lead.organizationId);
        } else {
            log(`[AVISO] Lead vendido (id=${leadId}, name='${lead?.lead}') não possui organizationId e será ignorado.`);
        }
    });
    log(`Mapeadas ${validOrgIds.size} organizações únicas a partir dos leads vendidos.`);

    log('Buscando todas as organizações...');
    const allOrgs = await fetchOrganizations(token, baseUrl, log);
    const orgsMap = new Map(allOrgs.map(org => [org.id, org]));
    log(`Total de ${allOrgs.length} organizações encontradas.`);

    const validRows: any[] = [];
    const invalidRows: any[] = [];
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
             log(`[ERRO] Organização (id=${orgId}) encontrada nos leads, mas não encontrada na lista de organizações. Será descartada.`);
             invalidRows.push({ orgId, reason: 'Organização não encontrada' });
        }
    });

    log(`Processamento de empresas concluído. Válidas=${validRows.length}, Inválidas=${invalidRows.length}, Domínios ausentes=${missingWebsiteCount}`);

    const content = buildCsv(HEADERS.COMPANIES, validRows.map(row => HEADERS.COMPANIES.map(h => sanitizeCsvValue(row[h]))));
    return { content, fileName: 'companies.csv' };
}

export async function exportDataForMode(
  mode: ExportMode,
  token: string,
  baseUrl: string
): Promise<{ fileContent: Buffer; fileName: string }> {
  const zip = new JSZip();
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const logMessages: string[] = [];
  const log: LogCallback = (message) => logMessages.push(`[${new Date().toISOString()}] ${message}`);

  log(`Iniciando exportação no modo: ${mode}`);

  if (mode === 'sold') {
    log('Gerando arquivo de empresas...');
    const { content: companiesCsv, fileName: companiesFileName } = await generateCompaniesCsv(token, baseUrl, log);
    zip.file(companiesFileName, companiesCsv);
    log(`Arquivo ${companiesFileName} adicionado ao zip.`);

    // TODO: Implementar e adicionar outros arquivos (contatos, negócios) aqui.

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
