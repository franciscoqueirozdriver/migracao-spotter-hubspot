
import { Transform } from 'stream';

/**
 * Escapes a value for CSV:
 * - null/undefined -> ""
 * - Objects/Arrays -> JSON.stringify
 * - Strings with " -> escaped "
 * - Wraps in " if contains separator, newline, or quotes.
 */
export function safeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  let stringValue: string;

  if (typeof value === 'object') {
    // Dates are objects but often handled as strings.
    // However, if it is a plain object/array, stringify it.
    // If it's a Date object, toISOString().
    if (value instanceof Date) {
        stringValue = value.toISOString();
    } else {
        try {
            stringValue = JSON.stringify(value);
        } catch (e) {
            stringValue = "[Circular/Error]";
        }
    }
  } else {
    stringValue = String(value);
  }

  // Check for characters that require escaping
  if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('\r')) {
    // Replace " with ""
    stringValue = stringValue.replace(/"/g, '""');
    // Wrap in quotes
    return `"${stringValue}"`;
  }

  return stringValue;
}

/**
 * Creates a CSV row string from an object and a list of headers.
 */
export function createCsvRow(headers: string[], item: Record<string, unknown>): string {
    return headers.map(h => safeCsvField(item[h])).join(',');
}

/**
 * A Transform stream that accepts objects and outputs CSV lines.
 * It detects headers from the first chunk (or provided headers).
 * (Simplified for now: we will handle buffering in the main loop to ensure headers are known).
 */
