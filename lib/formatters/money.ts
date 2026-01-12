
const formatter = new Intl.NumberFormat('pt-BR', {
  useGrouping: false,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoneyBR(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '0,00';
  }

  const num = typeof value === 'string' ? Number(value) : value;

  if (!Number.isFinite(num)) {
      return '0,00';
  }

  return formatter.format(num);
}
