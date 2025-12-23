// lib/exporter.ts
import { generateCompaniesCsvStrict } from './exporters/companies';
import { generateContactsCsvStrict } from './exporters/contacts';
import { generateDealsItemsCsvStrict } from './exporters/deals';
import * as fs from 'fs';
import * as path from 'path';

export type LogCallback = (message: string) => void;
export type ExportMode = 'sold' | 'inProgress' | 'lost' | 'total';
export type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items' | 'leads';

export interface ExportLog {
  startedAt: string;
  finishedAt?: string;
  entity: ExportableEntity;
  modeRequested: string;
  modeApplied: string;
  totals: {
    leadsFetched?: number;
    soldFetched?: number;
    lostFetched?: number;
    dealsGenerated?: number;
    lineItemsGenerated?: number;
    // Generic counters for other entities
    recordsFetched?: number;
    recordsGenerated?: number;
  };
  discards: {
    leadsWithoutOrg?: number;
    leadsWithoutPerson?: number;
  };
  warnings: string[];
  errors: string[];
  lines: string[]; // Full text log buffer
}

// Global variable to store the last log (in-memory)
let lastExportLog: ExportLog | null = null;

// File path for persistent logging
const LOG_FILE_PATH = path.join(process.cwd(), 'last_export_log.json');

function saveLogToFile(log: ExportLog) {
    try {
        fs.writeFileSync(LOG_FILE_PATH, JSON.stringify(log, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save log to file:', e);
    }
}

export function getLastLog(): ExportLog | null {
  // Try memory first
  if (lastExportLog) return lastExportLog;

  // Try file
  try {
      if (fs.existsSync(LOG_FILE_PATH)) {
          const content = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
          return JSON.parse(content) as ExportLog;
      }
  } catch (e) {
      console.error('Failed to read log from file:', e);
  }

  return null;
}

//region --- Função de Exportação Principal ---
export async function exportDataForMode(
  mode: ExportMode,
  entity: ExportableEntity,
  token: string,
  baseUrl: string
): Promise<{ csvContent: string, logContent: string, fileName: string }> {

  // Initialize the log object
  const currentLog: ExportLog = {
    startedAt: new Date().toISOString(),
    entity,
    modeRequested: mode,
    modeApplied: 'total', // We force 'total' as per requirements
    totals: {},
    discards: {},
    warnings: [],
    errors: [],
    lines: []
  };

  // Helper to append messages to warnings/errors and also keep a string buffer for legacy reasons if needed
  const logMessages: string[] = [];
  const log: LogCallback = (message) => {
    const msg = `[${new Date().toISOString()}] ${message}`;
    logMessages.push(msg);
    currentLog.lines.push(msg); // Add to persistent log lines
    console.log(msg); // Ensure it logs to backend console

    // Improved heuristic to classify warnings/errors
    if (message.includes('WARNING') || message.includes('WARN_')) currentLog.warnings.push(message);
    if (message.includes('ERROR') || message.includes('FATAL')) currentLog.errors.push(message);
  };

  log(`Iniciando exportação para entidade: ${entity}`);

  let csvContent = '';
  let fileName = 'export.csv';

  try {
      if (entity === 'companies') {
          csvContent = await generateCompaniesCsvStrict(token, baseUrl, log, currentLog);
          fileName = 'empresas.csv';
      } else if (entity === 'contacts') {
          csvContent = await generateContactsCsvStrict(token, baseUrl, log, currentLog);
          fileName = 'contatos.csv';
      } else if (entity === 'deals_line_items') {
          csvContent = await generateDealsItemsCsvStrict(token, baseUrl, log, currentLog);
          fileName = 'negocios_itens.csv';
      } else {
           throw new Error(`Entidade desconhecida ou não suportada: ${entity}`);
      }

      currentLog.finishedAt = new Date().toISOString();
      lastExportLog = currentLog; // Update global log on success
      saveLogToFile(currentLog); // Persist to file

  } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log(`ERRO FATAL: ${errorMsg}`);
      currentLog.errors.push(errorMsg);
      currentLog.finishedAt = new Date().toISOString();
      lastExportLog = currentLog; // Update global log on failure too
      saveLogToFile(currentLog); // Persist to file
      throw err;
  }

  const logContent = logMessages.join('\n');
  log('Exportação concluída com sucesso.');

  return { csvContent, logContent, fileName };
}
//endregion
