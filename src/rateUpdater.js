const { pool } = require("./db");

const RATE_API_URL = "https://open.er-api.com/v6/latest/BRL";
const DEFAULT_MARGIN_PERCENT = 2;

async function getSetting(key) {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}

async function setSetting(key, value) {
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [key, String(value)]
  );
}

// Récupère le taux BRL -> XOF du marché, applique la marge de Momo Connect,
// et met à jour rateXofPerBrl — mais seulement si rateSource = 'auto'.
async function fetchAndApplyRate({ force = false } = {}) {
  const source = (await getSetting("rateSource")) || "auto";
  if (source !== "auto" && !force) {
    return { skipped: true, reason: "rateSource est en mode manuel" };
  }

  const res = await fetch(RATE_API_URL);
  if (!res.ok) throw new Error(`Échec de la requête taux de change : ${res.status}`);
  const data = await res.json();
  if (data.result !== "success" || !data.rates?.XOF) {
    throw new Error("Réponse inattendue de l'API de taux de change (pas de XOF).");
  }

  const rawRate = data.rates.XOF;
  const marginPercent = parseFloat(await getSetting("rateMarginPercent")) || DEFAULT_MARGIN_PERCENT;
  const effectiveRate = Math.round(rawRate * (1 - marginPercent / 100) * 100) / 100;

  const now = new Date().toISOString();
  await setSetting("rateXofPerBrl", effectiveRate);
  await setSetting("rateRawMarketRate", rawRate);
  await setSetting("rateUpdatedAt", now);
  await setSetting("rateSource", source);

  return { effectiveRate, rawRate, marginPercent, updatedAt: now };
}

function startRateScheduler({ intervalHours = 6 } = {}) {
  fetchAndApplyRate().catch((err) => console.error("Échec de la mise à jour automatique du taux :", err.message));
  setInterval(() => {
    fetchAndApplyRate().catch((err) => console.error("Échec de la mise à jour automatique du taux :", err.message));
  }, intervalHours * 60 * 60 * 1000);
}

module.exports = { fetchAndApplyRate, startRateScheduler, DEFAULT_MARGIN_PERCENT };
