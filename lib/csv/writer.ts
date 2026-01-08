
/**
 * Sanitizes a value for CSV output (RFC4180).
 */
export function sanitizeCsvValue(value: unknown): string {
    if (value === null || value === undefined) {
      return ''; // Empty string for null/undefined per typical CSV expectation, or '""' if you prefer quoted empty.
      // RFC4180 doesn't strictly say, but usually empty field is just empty.
      // However, to be safe and consistent with previous logic:
      // strict RFC4180: field containing line breaks, double quotes, or commas should be enclosed in double-quotes.
      // If the field contains a double quote, the double quote must be escaped by preceding it with another double quote.
    }

    const str = String(value);

    // Check if it's already an Excel formula (user requirement)
    if (str.startsWith('="') && str.endsWith('"')) {
        return str;
    }

    // Check if needs quoting
    const needsQuotes = str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r');

    if (needsQuotes) {
      return `"${str.replace(/"/g, '""')}"`;
    }

    return str;
  }

  /**
   * Generates a CSV string from headers and data.
   */
  export function generateCsv(headers: string[], rows: Record<string, unknown>[]): string {
    const headerRow = headers.map(h => sanitizeCsvValue(h)).join(',');

    const dataRows = rows.map(row => {
      return headers.map(header => {
        // Find the value for the header (assuming row keys match headers or we need a mapping?)
        // The prompt implies we construct the row objects to match headers or similar.
        // For flexibility, let's assume 'row' has keys matching 'headers' OR we just iterate headers.
        // However, standard is usually array of objects.
        // If keys don't match, we get undefined -> empty string.
        return sanitizeCsvValue(row[header]);
      }).join(',');
    });

    return [headerRow, ...dataRows].join('\n');
  }

  /**
   * Generates a CSV string from headers and array of arrays.
   */
  export function generateCsvFromRows(headers: string[], rows: unknown[][]): string {
      const headerRow = headers.map(h => sanitizeCsvValue(h)).join(',');
      const dataRows = rows.map(row => row.map(cell => sanitizeCsvValue(cell)).join(','));
      return [headerRow, ...dataRows].join('\n');
  }
