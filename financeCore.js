// =====================
// financeCore.js
// Regras de negócio (SEM DOM, SEM FIREBASE)
// =====================

import { toEUR } from "../services/currencyService.js";

// =====================
// CALCULAR RESUMO
// =====================
export function calcularResumo({ receitas, despesas, dividas, taxa }) {
  let totalReceitas = 0;
  let totalDespesas = 0;
  let totalDividas  = 0;

  receitas.forEach(r => {
    totalReceitas += toEUR(r.val, r.moeda, taxa);
  });

  despesas.forEach(d => {
    totalDespesas += toEUR(d.val, d.moeda, taxa);
  });

  dividas.forEach(d => {
    const totalEUR = toEUR(d.valorOriginal, d.moeda, taxa);
    const pagoEUR  = toEUR(d.pago || 0, d.moeda, taxa);
    const restante = Math.max(0, totalEUR - pagoEUR);

    if (restante > 0) totalDividas += restante;
  });

  const saldo     = totalReceitas - totalDespesas;
  const saldoReal = saldo - totalDividas;

  return {
    totalReceitas,
    totalDespesas,
    totalDividas,
    saldo,
    saldoReal
  };
}
