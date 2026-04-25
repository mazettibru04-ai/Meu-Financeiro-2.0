export function calcularResumo(receitas, despesas, dividas) {
  const totalReceitas = receitas.reduce((a, b) => a + b, 0);
  const totalDespesas = despesas.reduce((a, b) => a + b, 0);
  const totalDividas  = dividas.reduce((a, b) => a + b, 0);

  const saldo = totalReceitas - totalDespesas;
  const saldoReal = saldo - totalDividas;

  return {
    totalReceitas,
    totalDespesas,
    totalDividas,
    saldo,
    saldoReal
  };
}
