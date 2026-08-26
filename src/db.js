const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("ERREUR: définissez DATABASE_URL dans votre .env (fournie automatiquement par Railway/Render si vous ajoutez une base Postgres).");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // La plupart des Postgres managés (Railway, Render) exigent SSL ; désactivable via PGSSL=off en local.
  ssl: process.env.PGSSL === "off" ? false : { rejectUnauthorized: false },
});

async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
}

module.exports = { pool, initSchema };
