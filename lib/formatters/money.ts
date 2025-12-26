
export function formatMoneyForCsv(v: unknown): string {
  if (v === null || v === undefined || v === "") return "0.00";

  // Number vindo do Spotter: não inventar regra; só padronizar 2 casas
  if (typeof v === "number" && Number.isFinite(v)) return v.toFixed(2);

  // String: aceitar "58239.96" ou "58.239,96" e converter com segurança
  if (typeof v === "string") {
    let s = v.trim();

    // Fix for the specific case where dot might be thousand separator and comma decimal
    // If string has both, assume dot is thousand separator and remove it
    if (s.includes(",") && s.includes(".")) {
        s = s.replace(/\./g, "").replace(",", ".");
    } else if (s.includes(",")) {
        // If only comma, assume it's decimal
        s = s.replace(",", ".");
    }
    // If only dot, assume it's already decimal (standard float string)

    const n = Number(s);
    return Number.isFinite(n) ? n.toFixed(2) : "0.00";
  }

  return "0.00";
}
