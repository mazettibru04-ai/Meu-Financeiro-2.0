let rates = {};

export function setRates(r) {
  rates = r;
}

export function toEUR(valor, moeda) {
  if (moeda === "EUR") return Number(valor);
  if (moeda === "BRL") return Number(valor) / (rates.BRL || 1);
  if (moeda === "USD") return Number(valor) / (rates.USD || 1);
  return Number(valor);
}

export function fromEUR(valor, moeda) {
  if (moeda === "EUR") return Number(valor);
  if (moeda === "BRL") return Number(valor) * (rates.BRL || 1);
  if (moeda === "USD") return Number(valor) * (rates.USD || 1);
  return Number(valor);
}

export function convert(valor, de, para) {
  const eur = toEUR(valor, de);
  return fromEUR(eur, para);
}

export function format(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
