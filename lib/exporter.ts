// lib/exporter.ts
import { fetchAllSpotterOData } from './spotter';
import { buildCsv, sanitizeCsvValue } from './csv';
import { v4 as uuidv4 } from 'uuid';
import { saveExport } from './exportStorage';
import JSZip from 'jszip';

//region Type Definitions
export type LogCallback = (message: string) => void;
export type ExportMode = 'sold'; // For now, only 'sold' is fully specified
export type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items';

// Spotter API Interfaces
interface SpotterLeadSold { id: number; leadId: number; saleDate: string; products?: SpotterProduct[] }
interface SpotterProduct { id: number; name?: string; quantity?: number; individualValue?: number; }
interface SpotterLead { id: number; lead?: string; organizationId?: number; source?: { value?: string }; }
interface SpotterLeadAndPerson { id: number; lead?: string; organizationId?: number; source?: { value?: string }; persons?: SpotterPerson[] }
interface SpotterOrganization { id: number; name?: string; website?: string; socialCnpj?: string; address?: string; addressNumber?: string; addressComplement?: string; district?: string; postalCode?: string; city?: string; state?: string; country?: string; }
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
const mapOrigem = (val?: string) => (val?.toLowerCase().includes('prospeccao ativa') ? 'Outbound' : 'Inbound');
const splitName = (name = '') => {
    const parts = name.trim().split(/\s+/);
    return { firstName: parts.shift() || '', lastName: parts.join(' ') || '-' };
};
//endregion

//region --- DATA FETCHING ---
const fetchLeadsSold = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterLeadSold>(`${baseUrl}/v3/LeadsSold`, token, log);
const fetchLeadsAndPersons = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterLeadAndPerson>(`${baseUrl}/v3/LeadsAndPersons`, token, log);
const fetchOrganizations = (token: string, baseUrl: string, log: LogCallback) => fetchAllSpotterOData<SpotterOrganization>(`${baseUrl}/v3/organization`, token, log);
//endregion

//region --- CSV GENERATION ---

// A) Companies
async function generateCompaniesCsv(soldOrgIds: Set<number>, token: string, baseUrl: string, log: LogCallback) {
    log('Filtrando empresas vendidas...');
    const allOrgs = await fetchOrganizations(token, baseUrl, log);
    const soldOrgs = allOrgs.filter(org => soldOrgIds.has(org.id));
    log(`Encontradas ${soldOrgs.length} empresas correspondentes.`);

    const validRows: any[] = [];
    const rejectedRows: any[] = [];

    for (const org of soldOrgs) {
        const row = {
            'Nome da empresa': org.name, 'Nome de domínio da empresa': org.website, 'CNPJ': org.socialCnpj,
            'Endereço': org.address, 'Número': org.addressNumber, 'Complemento': org.addressComplement,
            'Bairro': org.district, 'Código postal': org.postalCode, 'Cidade': org.city,
            'Estado/Região': org.state, 'País/Região': org.country, 'spotter_organization_id': org.id
        };

        // Quality Rule
        if (!row.spotter_organization_id) {
            rejectedRows.push({ ...row, rejection_reason: 'missing_spotter_organization_id' });
        } else {
            validRows.push(row);
        }
    }
    return {
        valid: buildCsv(HEADERS.COMPANIES, validRows.map(row => HEADERS.COMPANIES.map(h => sanitizeCsvValue(row[h])))),
        rejected: rejectedRows.length ? buildCsv([...HEADERS.COMPANIES, 'rejection_reason'], rejectedRows.map(row => [...HEADERS.COMPANIES, 'rejection_reason'].map(h => sanitizeCsvValue(row[h])))) : '',
        counts: { exported: validRows.length, rejected: rejectedRows.length }
    };
}

// B) Contacts
function generateContactsCsv(soldLeads: Map<number, SpotterLeadAndPerson>, log: LogCallback) {
    log('Gerando CSV de contatos...');
    const validRows: any[] = [];
    const rejectedRows: any[] = [];

    soldLeads.forEach(lead => {
        (lead.persons ?? []).forEach(person => {
            const { firstName, lastName } = splitName(person.name);
            const phone1 = person.phones?.[0]?.number;
            const phone2 = person.phones?.[1]?.number;
            const social = person.social?.[0];
            const row = {
                'E-mail': person.emails?.[0]?.address, 'Nome': firstName, 'Sobrenome': lastName, 'Cargo': person.role,
                'Telefone': phone1, 'Telefone 2': phone2, 'spotter_person_id': person.id, 'spotter_lead_id': person.leadId,
                'spotter_main_contact': person.mainContact, 'spotter_messaging_platform': social?.platform, 'spotter_messaging_id': social?.id,
            };
            // Quality Rule
            if (!row.spotter_person_id || !row.spotter_lead_id) {
                rejectedRows.push({ ...row, rejection_reason: 'missing_person_or_lead_id' });
            } else {
                validRows.push(row);
            }
        });
    });
    return {
        valid: buildCsv(HEADERS.CONTACTS, validRows.map(row => HEADERS.CONTACTS.map(h => sanitizeCsvValue(row[h])))),
        rejected: rejectedRows.length ? buildCsv([...HEADERS.CONTACTS, 'rejection_reason'], rejectedRows.map(row => [...HEADERS.CONTACTS, 'rejection_reason'].map(h => sanitizeCsvValue(row[h])))) : '',
        counts: { exported: validRows.length, rejected: rejectedRows.length }
    };
}

// C) Deals + Line Items
function generateDealsLineItemsCsv(sales: SpotterLeadSold[], leadsMap: Map<number, SpotterLeadAndPerson>, log: LogCallback) {
    log('Gerando CSV de negócios e itens de linha...');
    const validRows: any[] = [];
    const rejectedRows: any[] = [];

    for (const sale of sales) {
        const lead = leadsMap.get(sale.leadId);
        const persons = lead?.persons ?? [];
        const mainContact = persons.find(p => p.mainContact) ?? persons.find(p => p.emails?.[0]?.address) ?? persons[0];

        (sale.products ?? [{ id: 0 }]).forEach(product => { // Ensure at least one line per sale
            const row = {
                'Nome do negócio': `${lead?.lead ?? 'Lead'} - ${product.name ?? 'Produto'}`,
                'Pipeline': 'default', 'Etapa do negócio': 'Vendido', 'spotter_sale_id': sale.id, 'spotter_lead_id': sale.leadId,
                'spotter_sale_date': formatDate(sale.saleDate), 'origem_comercial_real': mapOrigem(lead?.source?.value),
                'spotter_organization_id': lead?.organizationId, 'spotter_person_id': mainContact?.id,
                'Nome': product.name, 'Quantidade': product.quantity, 'Preço unitário': product.individualValue, 'spotter_product_id': product.id,
                // Empty fields as per spec
                'spotter_sale_stage': '', 'spotter_cycle': '', 'spotter_total_deal_value': '', 'spotter_salesrep_email': '',
                'spotter_presales_email': '', 'spotter_discount_amount': '', 'spotter_discount_type': '', 'spotter_final_value': '',
            };

            // Quality Rule
            const required = [row.spotter_sale_id, row.spotter_lead_id, row.Nome, row.Quantidade, row['Preço unitário'], row.spotter_product_id];
            if (required.some(val => val === null || val === undefined)) {
                rejectedRows.push({ ...row, rejection_reason: 'missing_required_deal_fields' });
            } else {
                validRows.push(row);
            }
        });
    }
    return {
        valid: buildCsv(HEADERS.DEALS_LINE_ITEMS, validRows.map(row => HEADERS.DEALS_LINE_ITEMS.map(h => sanitizeCsvValue(row[h])))),
        rejected: rejectedRows.length ? buildCsv([...HEADERS.DEALS_LINE_ITEMS, 'rejection_reason'], rejectedRows.map(row => [...HEADERS.DEALS_LINE_ITEMS, 'rejection_reason'].map(h => sanitizeCsvValue(row[h])))) : '',
        counts: { exported: validRows.length, rejected: rejectedRows.length }
    };
}
//endregion

//region --- MAIN ORCHESTRATOR ---
export async function exportDataForMode(
  mode: ExportMode,
  entities: ExportableEntity[],
  token: string,
  baseUrl: string,
  log: LogCallback
): Promise<{ exportId: string }> {
    const exportId = uuidv4();
    log(`Iniciando exportação (ID: ${exportId}) no modo '${mode}'...`);

    // --- Sold Mode Data Aggregation ---
    log('Buscando dados de vendas e leads...');
    const sales = await fetchLeadsSold(token, baseUrl, log);
    const soldLeadIds = new Set(sales.map(s => s.leadId));
    const leadsAndPersons = await fetchLeadsAndPersons(token, baseUrl, log);

    const soldLeadsMap = new Map<number, SpotterLeadAndPerson>();
    const soldOrgIds = new Set<number>();

    for(const lead of leadsAndPersons) {
        if (soldLeadIds.has(lead.id)) {
            soldLeadsMap.set(lead.id, lead);
            if (lead.organizationId) {
                soldOrgIds.add(lead.organizationId);
            }
        }
    }
    log(`Encontrados ${soldLeadsMap.size} leads vendidos e ${soldOrgIds.size} organizações únicas.`);

    const files: { name: string, content: string }[] = [];

    // --- CSV Generation ---
    if (entities.includes('companies')) {
        const { valid, rejected, counts } = await generateCompaniesCsv(soldOrgIds, token, baseUrl, log);
        if (valid) files.push({ name: `${exportId}_companies.csv`, content: valid });
        if (rejected) files.push({ name: `${exportId}_companies_rejected.csv`, content: rejected });
        log(`Empresas: ${counts.exported} exportadas, ${counts.rejected} rejeitadas.`);
    }
    if (entities.includes('contacts')) {
        const { valid, rejected, counts } = generateContactsCsv(soldLeadsMap, log);
        if (valid) files.push({ name: `${exportId}_contacts.csv`, content: valid });
        if (rejected) files.push({ name: `${exportId}_contacts_rejected.csv`, content: rejected });
        log(`Contatos: ${counts.exported} exportados, ${counts.rejected} rejeitados.`);
    }
    if (entities.includes('deals_line_items')) {
        const { valid, rejected, counts } = generateDealsLineItemsCsv(sales, soldLeadsMap, log);
        if (valid) files.push({ name: `${exportId}_deals_line_items.csv`, content: valid });
        if (rejected) files.push({ name: `${exportId}_deals_line_items_rejected.csv`, content: rejected });
        log(`Negócios/Itens: ${counts.exported} exportados, ${counts.rejected} rejeitados.`);
    }

    if (files.length === 0) {
        log('Nenhum arquivo gerado.');
        return { exportId };
    }

    // --- File Persistence ---
    let finalBuffer: Buffer;
    let finalFileName: string;

    if (files.length > 1) {
        log('Criando arquivo ZIP...');
        const zip = new JSZip();
        files.forEach(f => zip.file(f.name, f.content));
        finalBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        finalFileName = `${exportId}_export.zip`;
    } else {
        finalBuffer = Buffer.from(files[0].content, 'utf-8');
        finalFileName = files[0].name;
    }

    await saveExport(exportId, finalFileName, finalBuffer);
    log(`Exportação salva como ${finalFileName}.`);

    return { exportId };
}
//endregion
