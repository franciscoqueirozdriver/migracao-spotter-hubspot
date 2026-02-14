
export function formatMoneyBR(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '0,00';
  }

  let num: number;

  if (typeof value === 'number') {
    num = value;
  } else {
    // If string, try to parse robustly.
    // If it comes as "58239,96" (already PT-BR), convert to standard float first.
    let s = value.trim();
    if (s.includes(",") && s.includes(".")) {
        // Assume dot thousand, comma decimal -> standard float
        s = s.replace(/\./g, "").replace(",", ".");
    } else if (s.includes(",")) {
        // Assume comma decimal -> standard float
        s = s.replace(",", ".");
    }

    num = Number(s);
  }

  if (!Number.isFinite(num)) {
      return '0,00';
  }

  // Format to PT-BR: Comma decimal, NO thousand separator
  // We can simulate this easily: toFixed(2) -> replace dot with comma
  return num.toFixed(2).replace('.', ',');
}
