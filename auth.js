const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

function issueAdminToken() {
  return jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentification requise." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") throw new Error("rôle invalide");
    next();
  } catch (err) {
    return res.status(401).json({ error: "Session admin invalide ou expirée." });
  }
}

module.exports = { issueAdminToken, requireAdmin };
