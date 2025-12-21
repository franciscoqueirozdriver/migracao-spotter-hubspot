// lib/exporter.ts
import { generateCompaniesCsvStrict } from './exporters/companies';
import { generateContactsCsvStrict } from './exporters/contacts';
import { generateDealsItemsCsvStrict } from './exporters/deals';

export type LogCallback = (message: string) => void;
export type ExportMode = 'sold' | 'inProgress' | 'lost' | 'total';
export type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items' | 'leads';

//region --- Função de Exportação Principal ---
export async function exportDataForMode(
  mode: ExportMode, // Ignored logic-wise for now as user wants strict simple mapping by entity
  entity: ExportableEntity,
  token: string,
  baseUrl: string
): Promise<{ csvContent: string, logContent: string, fileName: string }> {
  const logMessages: string[] = [];
  const log: LogCallback = (message) => logMessages.push(`[${new Date().toISOString()}] ${message}`);

  log(`Iniciando exportação para entidade: ${entity}`);

  let csvContent = '';
  let fileName = 'export.csv';

  try {
      if (entity === 'companies') {
          csvContent = await generateCompaniesCsvStrict(token, baseUrl, log);
          fileName = 'empresas.csv';
      } else if (entity === 'contacts') {
          csvContent = await generateContactsCsvStrict(token, baseUrl, log);
          fileName = 'contatos.csv';
      } else if (entity === 'deals_line_items') {
          csvContent = await generateDealsItemsCsvStrict(token, baseUrl, log);
          fileName = 'negocios_itens.csv';
      } else {
           // 'leads' might be passed here if extended, but UI only supports top 3.
           throw new Error(`Entidade desconhecida ou não suportada: ${entity}`);
      }
  } catch (err) {
      log(`ERRO FATAL: ${err}`);
      throw err;
  }

  const logContent = logMessages.join('\n');
  log('Exportação concluída com sucesso.');

  return { csvContent, logContent, fileName };
}
//endregion
