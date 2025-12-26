
export function formatMoneyBRLForCSV(value: unknown): string {
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

        // Logic to handle potential integer input stored as string (e.g. "5823996") vs "58239.96" vs "58239,96"
        // This is tricky without knowing source intent, but based on "100x bigger" bug report:

        // If it has a comma, it's almost certainly PT-BR decimal "58239,96" or "58.239,96".
        if (clean.includes(',')) {
            clean = clean.replace(/\./g, '').replace(',', '.');
            const num = parseFloat(clean);
            return isNaN(num) ? "0.00" : num.toFixed(2);
        }

        // If it has NO comma but has a dot: "58239.96" -> Standard float.
        if (clean.includes('.')) {
             const num = parseFloat(clean);
             return isNaN(num) ? "0.00" : num.toFixed(2);
        }

        // If it has NO comma and NO dot: "5823996" -> Integer.
        // BUG CONTEXT: User says "veio na exportação como 5823996 - Originalmente é 58239,96".
        // This means the API might be sending an integer representing centavos, OR our code stripped the comma earlier.
        // Assuming strict "Money" fields from Spotter might be integers in cents in some contexts?
        // OR we simply assume if it looks like a large integer (no separators), treat as is?
        // User instruction: "não adivinhar... corrigir na origem".
        // BUT if the origin *is* this string, we must handle it.

        // However, the prompt says: "Valores vindos do Spotter (JSON): trate como number em reais (ex.: 58239.96)."
        // So if we get "5823996", it is interpreted as 5.8 million.
        // Unless we *know* it's cents.
        // Let's stick to standard float parsing.
        // If "5823996" comes in, it becomes "5823996.00".
        // The fix is likely that `toMoney2` was correct, but something else was doing `replace(/\D/g, '')`.
        // I checked greps, didn't find it in exporters.

        // Wait, maybe the user opened the CSV in Excel and *Excel* stripped it?
        // "CSV abre em Excel/Google Sheets sem perder casas decimais".
        // If I write "58239.96" in CSV, Excel handles it.

        // Let's implement robust standard parsing.
        const num = parseFloat(clean);
        return isNaN(num) ? "0.00" : num.toFixed(2);
    }

    return "0.00";
}
