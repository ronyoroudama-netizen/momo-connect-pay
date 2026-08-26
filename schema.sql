-- Schéma de la base de données Momo Connect — système de paiement (PostgreSQL)

CREATE TABLE IF NOT EXISTS demandes (
  id SERIAL PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,

  -- Expéditeur
  client_name TEXT NOT NULL,
  cpf TEXT NOT NULL,               -- stocké sans ponctuation, 11 chiffres
  city TEXT NOT NULL,
  email TEXT NOT NULL,
  motif TEXT NOT NULL,
  amount_brl NUMERIC(12,2) NOT NULL,
  amount_xof NUMERIC(14,2),
  rate_used NUMERIC(10,4),

  -- Destinataire
  beneficiary_name TEXT NOT NULL,
  beneficiary_phone TEXT NOT NULL,

  -- Statut : pending | declared | confirmed
  status TEXT NOT NULL DEFAULT 'pending',

  created_at TIMESTAMPTZ NOT NULL,
  declared_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_demandes_status ON demandes(status);
CREATE INDEX IF NOT EXISTS idx_demandes_created_at ON demandes(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Valeurs par défaut (à modifier ensuite depuis l'espace admin)
INSERT INTO settings (key, value) VALUES ('pixKey', '(19) 98211-7687') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('whatsapp', '5519982117687') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('companyName', 'Momo Connect Ltda') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('rateXofPerBrl', '105') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('rateUpdatedAt', '') ON CONFLICT (key) DO NOTHING;
