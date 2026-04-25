// =====================
// currencyService.js
// Responsável por TODA conversão de moeda
// =====================

export function toEUR(valor, moeda, taxa) {
  if (!valor) return 0;
  if (moeda === "EUR") return Number(valor);
  if (moeda === "BRL" && taxa > 0) return Number(valor) / taxa;
  return Number(valor);
}

export function toBRL(valorEUR, taxa) {
  if (!valorEUR || taxa <= 0) return 0;
  return Number(valorEUR) * taxa;
}

export function format(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
