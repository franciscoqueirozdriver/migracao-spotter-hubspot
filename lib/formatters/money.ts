
export function toMoney2(value: unknown): string {
    if (value === null || value === undefined) {
        return "0.00";
    }

    if (typeof value === 'number') {
        if (isNaN(value)) return "0.00";
        return value.toFixed(2);
    }

    if (typeof value === 'string') {
        let clean = value.trim();
        if (clean === '') return "0.00";

        // Handle PT-BR format "58.239,96" or "58239,96"
        // If it has comma as decimal separator
        if (clean.includes(',')) {
            // Remove thousands separators (dots) before the comma
            // BUT: be careful if it's mixed like 1.234,56
            // Strategy: replace all dots with empty, then replace comma with dot

            // Check if it really looks like pt-BR (has comma at end or dot before comma)
            // Or just generic "comma is decimal" rule
            clean = clean.replace(/\./g, '').replace(',', '.');
        }
        // Else if it has no comma but has dot? "58239.96" -> keep it.

        const num = parseFloat(clean);
        if (isNaN(num)) return "0.00";
        return num.toFixed(2);
    }

    return "0.00";
}
