require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { pool, initSchema } = require("./db");
const { onlyDigits, isValidCPF, isValidEmail, generateReference } = require("./validators");
const { issueAdminToken, requireAdmin } = require("./auth");
const { fetchAndApplyRate, startRateScheduler } = require("./rateUpdater");

if (!process.env.JWT_SECRET || !process.env.ADMIN_PASSWORD) {
  console.error("ERREUR: définissez ADMIN_PASSWORD et JWT_SECRET dans votre fichier .env avant de démarrer.");
  process.exit(1);
}

const app = express();
app.use(express.json());

const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));

async function getAllSettings() {
  const { rows } = await pool.query("SELECT key, value FROM settings");
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return obj;
}

async function getPublicSettings() {
  const s = await getAllSettings();
  return {
    pixKey: s.pixKey,
    whatsapp: s.whatsapp,
    companyName: s.companyName,
    rateXofPerBrl: parseFloat(s.rateXofPerBrl) || 0,
    rateUpdatedAt: s.rateUpdatedAt || null,
    rateSource: s.rateSource || "auto",
  };
}

function rowToDemande(row) {
  return {
    reference: row.reference,
    clientName: row.client_name,
    cpf: row.cpf,
    city: row.city,
    email: row.email,
    motif: row.motif,
    amount: parseFloat(row.amount_brl),
    amountXOF: row.amount_xof !== null ? parseFloat(row.amount_xof) : null,
    rateUsed: row.rate_used !== null ? parseFloat(row.rate_used) : null,
    beneficiaryName: row.beneficiary_name,
    beneficiaryPhone: row.beneficiary_phone,
    status: row.status,
    createdAt: row.created_at,
    declaredAt: row.declared_at,
    confirmedAt: row.confirmed_at,
  };
}

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

app.get("/api/settings", asyncRoute(async (req, res) => {
  res.json(await getPublicSettings());
}));

app.post("/api/demandes", asyncRoute(async (req, res) => {
  const b = req.body || {};
  const errors = {};

  const clientName = String(b.clientName || "").trim();
  const cpf = onlyDigits(b.cpf);
  const city = String(b.city || "").trim();
  const email = String(b.email || "").trim();
  const motif = String(b.motif || "").trim();
  const amount = parseFloat(b.amount);
  const beneficiaryName = String(b.beneficiaryName || "").trim();
  const beneficiaryPhone = onlyDigits(b.beneficiaryPhone);

  if (clientName.length < 3) errors.clientName = "Nom et prénoms requis.";
  if (!isValidCPF(cpf)) errors.cpf = "CPF invalide.";
  if (!city) errors.city = "Ville de résidence requise.";
  if (!isValidEmail(email)) errors.email = "E-mail invalide.";
  if (!motif) errors.motif = "Motif du transfert requis.";
  if (!amount || isNaN(amount) || amount <= 0) errors.amount = "Montant invalide.";
  if (beneficiaryName.length < 3) errors.beneficiaryName = "Nom et prénoms du destinataire requis.";
  if (beneficiaryPhone.length < 8) errors.beneficiaryPhone = "Numéro de téléphone invalide.";

  if (Object.keys(errors).length) return res.status(400).json({ errors });

  const settings = await getAllSettings();
  const rate = parseFloat(settings.rateXofPerBrl) || null;
  const amountXOF = rate ? Math.round(amount * rate) : null;

  let reference;
  for (let attempt = 0; attempt < 5; attempt++) {
    reference = generateReference();
    try {
      await pool.query(
        `INSERT INTO demandes
           (reference, client_name, cpf, city, email, motif, amount_brl, amount_xof, rate_used, beneficiary_name, beneficiary_phone, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12)`,
        [reference, clientName, cpf, city, email, motif, amount, amountXOF, rate, beneficiaryName, beneficiaryPhone, new Date().toISOString()]
      );
      break;
    } catch (err) {
      if (err.code !== "23505") throw err;
      if (attempt === 4) return res.status(500).json({ error: "Impossible de générer une référence unique. Réessayez." });
    }
  }

  res.status(201).json({ reference });
}));

app.get("/api/demandes/:reference", asyncRoute(async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM demandes WHERE reference = $1", [req.params.reference.toUpperCase()]);
  if (!rows[0]) return res.status(404).json({ error: "Aucune demande trouvée avec cette référence." });
  res.json(rowToDemande(rows[0]));
}));

app.post("/api/demandes/:reference/declare-paid", asyncRoute(async (req, res) => {
  const ref = req.params.reference.toUpperCase();
  const { rows } = await pool.query("SELECT * FROM demandes WHERE reference = $1", [ref]);
  if (!rows[0]) return res.status(404).json({ error: "Demande introuvable." });
  if (rows[0].status === "pending") {
    await pool.query("UPDATE demandes SET status = 'declared', declared_at = $1 WHERE reference = $2", [new Date().toISOString(), ref]);
  }
  const updated = await pool.query("SELECT * FROM demandes WHERE reference = $1", [ref]);
  res.json(rowToDemande(updated.rows[0]));
}));

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Mot de passe incorrect." });
  }
  res.json({ token: issueAdminToken() });
});

app.get("/api/admin/demandes", requireAdmin, asyncRoute(async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM demandes ORDER BY created_at DESC");
  res.json(rows.map(rowToDemande));
}));

app.post("/api/admin/demandes/:reference/confirm", requireAdmin, asyncRoute(async (req, res) => {
  const ref = req.params.reference.toUpperCase();
  const { rows } = await pool.query("SELECT * FROM demandes WHERE reference = $1", [ref]);
  if (!rows[0]) return res.status(404).json({ error: "Demande introuvable." });
  await pool.query("UPDATE demandes SET status = 'confirmed', confirmed_at = $1 WHERE reference = $2", [new Date().toISOString(), ref]);
  const updated = await pool.query("SELECT * FROM demandes WHERE reference = $1", [ref]);
  res.json(rowToDemande(updated.rows[0]));
}));

app.get("/api/admin/settings", requireAdmin, asyncRoute(async (req, res) => {
  res.json(await getAllSettings());
}));

app.post("/api/admin/settings", requireAdmin, asyncRoute(async (req, res) => {
  const allowed = ["pixKey", "whatsapp", "companyName", "rateXofPerBrl", "rateSource", "rateMarginPercent"];
  const b = req.body || {};

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const key of allowed) {
      if (b[key] !== undefined) {
        await client.query(
          "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
          [key, String(b[key])]
        );
      }
    }
    if (b.rateXofPerBrl !== undefined || b.rateMarginPercent !== undefined) {
      await client.query(
        "INSERT INTO settings (key, value) VALUES ('rateUpdatedAt', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [new Date().toISOString()]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.json(await getAllSettings());
}));

app.post("/api/admin/settings/refresh-rate", requireAdmin, asyncRoute(async (req, res) => {
  const result = await fetchAndApplyRate({ force: true });
  res.json({ result, settings: await getAllSettings() });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Erreur interne du serveur." });
});

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`API Momo Connect démarrée sur le port ${PORT}`));
    startRateScheduler({ intervalHours: 6 });
  })
  .catch((err) => {
    console.error("Impossible d'initialiser la base de données :", err);
    process.exit(1);
  });
