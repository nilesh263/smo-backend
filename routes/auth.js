const express = require("express");
const fs      = require("fs");
const path    = require("path");
const bcrypt  = require("bcryptjs");

const router = express.Router();

// Persist users to a JSON file on the (single, always-on) backend so accounts
// survive across requests — unlike an in-memory array on Vercel's stateless
// serverless functions, where each request can hit a fresh instance.
const DATA_DIR   = path.join(__dirname, "../data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); }
  catch (e) { return []; }
}
function saveUsers(users) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// POST /api/auth/register
router.post("/register", async function (req, res) {
  const { name, email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
  if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const e = String(email).trim().toLowerCase();
  const users = loadUsers();
  if (users.find(u => u.email === e)) return res.status(409).json({ error: "Email already registered" });

  const hashed = await bcrypt.hash(String(password), 10);
  const user = { id: Date.now().toString(), name: (name && name.trim()) || e.split("@")[0], email: e, password: hashed };
  users.push(user);
  saveUsers(users);

  res.json({ id: user.id, name: user.name, email: user.email });
});

// POST /api/auth/login
router.post("/login", async function (req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  const e = String(email).trim().toLowerCase();
  const user = loadUsers().find(u => u.email === e);
  if (!user) return res.status(404).json({ error: "No account found with this email" });

  const valid = await bcrypt.compare(String(password), user.password);
  if (!valid) return res.status(401).json({ error: "Incorrect password" });

  res.json({ id: user.id, name: user.name, email: user.email });
});

// POST /api/auth/reset
// NOTE: simple reset with no email verification — by design (casual app, tools
// work in guest mode). Anyone who knows an email could reset it; swap for an
// email-link flow if real account security is ever needed.
router.post("/reset", async function (req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and new password are required" });
  if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const e = String(email).trim().toLowerCase();
  const users = loadUsers();
  const user = users.find(u => u.email === e);
  if (!user) return res.status(404).json({ error: "No account found with this email" });

  user.password = await bcrypt.hash(String(password), 10);
  saveUsers(users);
  res.json({ success: true });
});

module.exports = router;
