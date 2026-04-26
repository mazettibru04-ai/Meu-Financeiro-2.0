function dateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fetchRateByDate(dateISO) {
  const response = await fetch(`https://api.frankfurter.app/${dateISO}?from=EUR&to=BRL`);
  if (!response.ok) throw new Error("Falha ao consultar câmbio histórico");
  const data = await response.json();
  return Number(data?.rates?.BRL || 0);
}

export async function fetchCambioSummary() {
  const [today, d7, d15, d30] = await Promise.all([
    fetchRateByDate("latest"),
    fetchRateByDate(dateDaysAgo(7)),
    fetchRateByDate(dateDaysAgo(15)),
    fetchRateByDate(dateDaysAgo(30))
  ]);

  return {
    today,
    history: { d7, d15, d30 }
  };
}
