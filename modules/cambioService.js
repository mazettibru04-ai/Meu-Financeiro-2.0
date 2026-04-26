const AWESOME_DAILY_URL = "https://economia.awesomeapi.com.br/json/daily/EUR-BRL/45";
const LEGACY_LATEST_URL = "https://api.exchangerate-api.com/v4/latest/EUR";

function toDayStart(dateLike) {
  const d = new Date(dateLike);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(a, b) {
  const ms = Math.abs(toDayStart(a).getTime() - toDayStart(b).getTime());
  return Math.round(ms / 86400000);
}

function pickClosestRate(records, targetDaysAgo) {
  const now = new Date();
  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() - targetDaysAgo);

  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  records.forEach((record) => {
    const distance = daysBetween(record.date, targetDate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = record.rate;
    }
  });

  return Number(best || 0);
}

async function fetchAwesomeDaily() {
  const response = await fetch(AWESOME_DAILY_URL, { redirect: "follow" });
  if (!response.ok) throw new Error("Falha ao consultar câmbio histórico");

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Resposta inválida da API de câmbio");
  }

  const parsed = data
    .map((item) => {
      const rate = Number(item?.bid);
      const ts = Number(item?.timestamp);
      if (!Number.isFinite(rate) || !Number.isFinite(ts)) return null;
      return { rate, date: new Date(ts * 1000) };
    })
    .filter(Boolean);

  if (!parsed.length) throw new Error("Sem dados válidos de câmbio");

  const today = parsed[0].rate;
  return {
    today,
    history: {
      d7: pickClosestRate(parsed, 7),
      d15: pickClosestRate(parsed, 15),
      d30: pickClosestRate(parsed, 30)
    }
  };
}

async function fetchLegacyLatest() {
  const response = await fetch(LEGACY_LATEST_URL, { redirect: "follow" });
  if (!response.ok) throw new Error("Falha ao consultar câmbio atual");
  const data = await response.json();
  const today = Number(data?.rates?.BRL || 0);
  if (!Number.isFinite(today) || today <= 0) throw new Error("Taxa atual inválida");
  return { today, history: { d7: today, d15: today, d30: today } };
}

export async function fetchCambioSummary() {
  try {
    return await fetchAwesomeDaily();
  } catch (error) {
    console.warn("Fallback de câmbio acionado:", error);
    return fetchLegacyLatest();
  }
}
