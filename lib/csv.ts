// lib/csv.ts

/**
 * Escapes a value for CSV format.
 */
export function sanitizeCsvValue(value: any): string {
  if (value === null || value === undefined) return '""';
  let stringValue = String(value);
  if (stringValue.startsWith('="') && stringValue.endsWith('"')) return stringValue;
  stringValue = stringValue.replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
  return `"${stringValue}"`;
}

/**
 * Builds a CSV string from headers and rows of data, adding a UTF-8 BOM.
 */
export function buildCsv(headers: string[], rows: string[][]): string {
  if (!Array.isArray(headers) || !Array.isArray(rows)) {
    throw new Error('Invalid input: headers and rows must be arrays.');
  }
  const bom = '\ufeff';
  const headerRow = headers.join(',');
  const dataRows = rows.map(row => row.join(',')).join('\n');
  return `${bom}${headerRow}\n${dataRows}`;
}
