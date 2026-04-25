// =====================
// currencyService.js
// Responsável por TODA conversão de moeda (MULTI-MOEDA)
// =====================

let rates = {
  EUR: 1
};

// Atualiza taxas (base EUR)
export function setRates(newRates) {
  rates = {
    EUR: 1,
    ...newRates
  };
}

// Converter QUALQUER moeda para EUR
export function toEUR(valor, moeda) {
  if (!valor) return 0;
  if (!rates[moeda]) return Number(valor);
  return Number(valor) / rates[moeda];
}

// Converter EUR para qualquer moeda
export function fromEUR(valorEUR, moeda) {
  if (!valorEUR) return 0;
  if (!rates[moeda]) return Number(valorEUR);
  return Number(valorEUR) * rates[moeda];
}

// Converter direto entre moedas
export function convert(valor, de, para) {
  const eur = toEUR(valor, de);
  return fromEUR(eur, para);
}

// Formatador padrão
export function format(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
