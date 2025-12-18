// lib/csv.ts

/**
 * Escapes a value for CSV format, handling quotes and newlines.
 * It always wraps the value in double quotes as per HubSpot's recommendation.
 */
export function sanitizeCsvValue(value: any): string {
  if (value === null || value === undefined) {
    return '""';
  }

  let stringValue = String(value);

  // Do not escape formulas for Excel (like ="...")
  if (stringValue.startsWith('="') && stringValue.endsWith('"')) {
      return stringValue;
  }

  // Escape internal double quotes by doubling them
  stringValue = stringValue.replace(/"/g, '""');

  // Remove newline characters
  stringValue = stringValue.replace(/[\r\n]+/g, ' ');

  // Wrap the final string in double quotes
  return `"${stringValue}"`;
}

/**
 * Builds a CSV string from headers and rows of data.
 * Adds a BOM (Byte Order Mark) for UTF-8 compatibility.
 * @param headers An array of strings for the header row.
 * @param rows A 2D array of values for the data rows.
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
