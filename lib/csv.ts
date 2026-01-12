// lib/csv.ts

/**
 * Sanitizes a value to be safely included in a CSV cell.
 * - Converts null/undefined to an empty string.
 * - Replaces newlines with spaces.
 * - Escapes double quotes by doubling them.
 * - Always wraps the final string in double quotes.
 * @param value The value to sanitize.
 * @returns A sanitized string ready for CSV.
 */
export function sanitizeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '""'; // Return quoted empty string
  }

  let str = String(value);

  // Remove newlines
  str = str.replace(/\r?\n|\r/g, ' ');

  // Escape double quotes
  str = str.replace(/"/g, '""');

  // Always wrap in double quotes to handle commas and other special characters
  return `"${str}"`;
}

/**
 * Builds a CSV string from headers and rows of data.
 * @param headers An array of strings representing the CSV headers.
 * @param rows A 2D array of strings, where each inner array is a row.
 * @returns A complete CSV string.
 * @throws An error if any row has a different number of columns than the headers.
 */
export function buildCsv(headers: string[], rows: string[][]): string {
  // Validate that every row has the correct number of columns
  rows.forEach((row, index) => {
    if (row.length !== headers.length) {
      throw new Error(
        `CSV build error: Row ${index + 1} is invalid. It has ${row.length} columns, but ${headers.length} were expected.`
      );
    }
  });

  const headerRow = headers.join(',');
  const dataRows = rows.map(row => row.join(',')).join('\n');

  return [headerRow, dataRows].join('\n');
}
