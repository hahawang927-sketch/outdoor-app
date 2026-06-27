const http = require("http");
const urlModule = require("url");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const ABILITIES = [
  { key: "endurance", label: "鑰愬姏" },
  { key: "strength", label: "浣撳姏" },
  { key: "technique", label: "鎶€鑳? },
  { key: "safety", label: "瀹夊叏鎰忚瘑" },
  { key: "teamwork", label: "鍗忎綔" },
];
const SCORE_MIN = 1;
const SCORE_MAX = 5;

// ============ Database Interface ============
let pool = null;

async function ensurePgDb() {
  if (!process.env.DATABASE_URL) return false;
  const { Pool } = require("pg");
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pool.query('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL)');
  await pool.query('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL)');
  await pool.query('CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, participants JSONB DEFAULT \'[]\', ratings JSONB DEFAULT \'[]\', updated_at TEXT NOT NULL)');
  await pool.query('CREATE TABLE IF NOT EXISTS user_profiles (user_id TEXT PRIMARY KEY, display_name TEXT, bio TEXT DEFAULT \'\', city TEXT DEFAULT \'\', phone TEXT DEFAULT \'\', preferences TEXT DEFAULT \'\', created_at TEXT, updated_at TEXT)');
  return true;
}

function ensureFileDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const seed = { version: 2, standard: { min: SCORE_MIN, max: SCORE_MAX, abilities: ABILITIES }, users: [], sessions: {}, activities: {}, userProfiles: {}, updatedAt: new Date().toISOString() };
    writeFileDb(seed);
  }
}
function readFileDb() { ensureFileDb(); return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); }
function writeFileDb(db) { db.updatedAt = new Date().toISOString(); fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + "\n", "utf8"); }

async function readDb() {
  if (pool) return await readPgDb();
  return readFileDb();
}
async function writeDb(db) {
  if (pool) { await writePgDb(db); return; }
  writeFileDb(db);
}

async function readPgDb() {
  const [usersR, sessionsR, activitiesR, profilesR] = await Promise.all([
    pool.query("SELECT * FROM users"),
    pool.query("SELECT * FROM sessions"),
    pool.query("SELECT * FROM activities"),
    pool.query("SELECT * FROM user_profiles"),
  ]);
  const users = usersR.rows.map(u => ({ id: u.id, username: u.username, passwordHash: u.password_hash, salt: u.salt, createdAt: u.created_at }));
  const sessions = {};
  for (const s of sessionsR.rows) sessions[s.token] = { userId: s.user_id, createdAt: s.created_at };
  const activities = {};
  for (const a of activitiesR.rows) activities[a.id] = { id: a.id, name: a.name, createdBy: a.created_by, createdAt: a.created_at, participants: a.participants || [], ratings: a.ratings || [], updatedAt: a.updated_at };
  const userProfiles = {};
  for (const p of profilesR.rows) userProfiles[p.user_id] = { displayName: p.display_name, bio: p.bio || "", city: p.city || "", phone: p.phone || "", preferences: p.preferences || "", createdAt: p.created_at, updatedAt: p.updated_at };
  return { version: 2, standard: { min: SCORE_MIN, max: SCORE_MAX, abilities: ABILITIES }, users, sessions, activities, userProfiles, updatedAt: new Date().toISOString() };
}

async function writePgDb(db) {
  const client = await pool.connect();
  try {
    /* -- BEGIN skipped skipped, each write is standalone */;
    await client.query("DELETE FROM users");
    for (const u of db.users) await client.query("INSERT INTO users(id,username,password_hash,salt,created_at) VALUES($1,$2,$3,$4,$5)", [u.id, u.username, u.passwordHash, u.salt, u.createdAt]);
    await client.query("DELETE FROM sessions");
    for (const [token, s] of Object.entries(db.sessions)) await client.query("INSERT INTO sessions(token,user_id,created_at) VALUES($1,$2,$3)", [token, s.userId, s.createdAt]);
    await client.query("DELETE FROM activities");
    for (const a of Object.values(db.activities)) await client.query("INSERT INTO activities(id,name,created_by,created_at,participants,ratings,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)", [a.id, a.name, a.createdBy, a.createdAt, JSON.stringify(a.participants), JSON.stringify(a.ratings), a.updatedAt]);
    await client.query("DELETE FROM user_profiles");
    for (const [uid, p] of Object.entries(db.userProfiles)) await client.query("INSERT INTO user_profiles(user_id,display_name,bio,city,phone,preferences,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [uid, p.displayName || "", p.bio || "", p.city || "", p.phone || "", p.preferences || "", p.createdAt || "", p.updatedAt || ""]);
  
  } catch (e) { throw e; }
  finally { client.release(); }
}

// ============ Helpers ============
function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64).toString("hex"); }
function generateSalt() { return crypto.randomBytes(16).toString("hex"); }
function makeUserId() { return "usr_" + crypto.randomBytes(8).toString("hex"); }
function makeSessionToken() { return crypto.randomUUID() + crypto.randomUUID(); }
function makeActId() { return "act_" + crypto.randomBytes(8).toString("hex"); }
async function getAuthUser(db, req) {
  const a = (req.headers["authorization"] || "").match(/^Bearer\s+(.+)$/i);
  if (!a) return null;
  const s = db.sessions[a[1]];
  return s ? (db.users.find((u) => u.id === s.userId) || null) : null;
}
function normalizeScores(input) {
  const scores = {};
  for (const a of ABILITIES) {
    const v = Number(input[a.key]);
    if (!Number.isInteger(v) || v < SCORE_MIN || v > SCORE_MAX) throw new Error(a.label + " must be " + SCORE_MIN + "-" + SCORE_MAX);
    scores[a.key] = v;
  }
  return scores;
}
function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
function serveStatic(req, res) {
  const parsed = urlModule.parse(req.url);
  const requested = parsed.pathname === "/" ? "/index.html" : decodeURIComponent(parsed.pathname);
  const fp = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const mimeMap = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
    res.writeHead(200, { "content-type": mimeMap[path.extname(fp)] || "application/octet-stream" });
    res.end(data);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; if (body.length > 1024 * 1024) { reject(new Error("Request too large")); req.destroy(); } });
    req.on("end", () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}
async function summarizeActivity(act) {
  const db = await readDb();
  const userMap = {};
  for (const u of db.users) userMap[u.id] = u.username;
  const participants = act.participants.map((pid) => ({ userId: pid, username: userMap[pid] || "Unknown" }));
  const averages = {};
  for (const pid of act.participants) {
    const related = act.ratings.filter((r) => r.targetId === pid);
    if (related.length === 0) continue;
    const totals = Object.fromEntries(ABILITIES.map((a) => [a.key, 0]));
    for (const r of related)
      for (const a of ABILITIES) totals[a.key] += r.scores[a.key];
    averages[pid] = Object.fromEntries(ABILITIES.map((a) => [a.key, Number((totals[a.key] / related.length).toFixed(2))]));
  }
  return { id: act.id, name: act.name, createdBy: act.createdBy, createdAt: act.createdAt, participants, participantCount: act.participants.length, ratings: act.ratings, averages, updatedAt: act.updatedAt };
}

// ============ HTTP Server ============
const server = http.createServer(async (req, res) => {
  try {
    const db = await readDb();
    const user = await getAuthUser(db, req);
    const parsedUrl = urlModule.parse(req.url);
    const method = req.method;
    const url = parsedUrl.pathname;

    if (method === "POST" && url === "/api/auth/register") {
      const { username, password } = await readBody(req);
      if (!username || !password || String(username).length < 2 || String(password).length < 4) throw new Error("Invalid username/password");
      if (db.users.find((u) => u.username === username)) throw new Error("Username taken");
      const salt = generateSalt();
      const ue = { id: makeUserId(), username, passwordHash: hashPassword(password, salt), salt, createdAt: new Date().toISOString() };
      db.users.push(ue);
      const token = makeSessionToken();
      db.sessions[token] = { userId: ue.id, createdAt: new Date().toISOString() };
      await writeDb(db);
      sendJson(res, 201, { token, user: { id: ue.id, username: ue.username } });
      return;
    }
    if (method === "POST" && url === "/api/auth/login") {
      const { username, password } = await readBody(req);
      const ue = db.users.find((u) => u.username === username);
      if (!ue || hashPassword(password, ue.salt) !== ue.passwordHash) throw new Error("Bad credentials");
      const token = makeSessionToken();
      db.sessions[token] = { userId: ue.id, createdAt: new Date().toISOString() };
      await writeDb(db);
      sendJson(res, 200, { token, user: { id: ue.id, username: ue.username } });
      return;
    }
    if (method === "POST" && url === "/api/auth/logout") {
      const m = (req.headers["authorization"] || "").match(/^Bearer\s+(.+)$/i);
      if (m) delete db.sessions[m[1]];
      await writeDb(db); sendJson(res, 200, { ok: true }); return;
    }
    if (method === "GET" && url === "/api/auth/me") {
      if (!user) { sendJson(res, 401, { error: "Not logged in" }); return; }
      sendJson(res, 200, { user: { id: user.id, username: user.username } }); return;
    }
    if (url.startsWith("/api/") && !user) { sendJson(res, 401, { error: "Login required" }); return; }

    const actMatchGet = url.match(/^\/api\/activities(?:\/|$)/);
    if (actMatchGet) {
      const parts = url.split("/");
      const actId = parts[3] || null;
      const action = parts[4] || null;

      if (method === "GET" && !actId) {
        const list = Object.values(db.activities).filter((a) => a.participants.includes(user.id)).map((a) => summarizeActivity(a));
        sendJson(res, 200, { activities: list.reverse() });
        return;
      }
      if (method === "POST" && !actId) {
        const { name } = await readBody(req);
        if (!name || String(name).trim().length === 0) throw new Error("Name required");
        const act = { id: makeActId(), name: String(name).trim(), createdBy: user.id, createdAt: new Date().toISOString(), participants: [user.id], ratings: [], updatedAt: new Date().toISOString() };
        db.activities[act.id] = act;
        await writeDb(db);
        sendJson(res, 201, { activity: await summarizeActivity(act) });
        return;
      }
      if (!actId || !db.activities[actId]) { sendJson(res, 404, { error: "Not found" }); return; }
      const act = db.activities[actId];

      if (method === "GET" && actId && !action) {
        if (!act.participants.includes(user.id)) throw new Error("Not a member");
        sendJson(res, 200, { activity: await summarizeActivity(act) });
        return;
      }
      if (method === "PUT" && actId && !action) {
        const { name } = await readBody(req);
        if (!name || String(name).trim().length === 0) throw new Error("Name required");
        act.name = String(name).trim();
        act.updatedAt = new Date().toISOString();
        await writeDb(db);
        sendJson(res, 200, { activity: await summarizeActivity(act) });
        return;
      }
      if (method === "POST" && actId && action === "join") {
        if (act.participants.includes(user.id)) throw new Error("Already joined");
        act.participants.push(user.id);
        act.updatedAt = new Date().toISOString();
        await writeDb(db);
        sendJson(res, 200, { activity: await summarizeActivity(act) });
        return;
      }
      if (method === "POST" && actId && action === "leave") {
        const idx = act.participants.indexOf(user.id);
        if (idx === -1) throw new Error("Not a member");
        act.participants.splice(idx, 1);
        act.updatedAt = new Date().toISOString();
        await writeDb(db);
        sendJson(res, 200, { activity: await summarizeActivity(act) });
        return;
      }
      if (method === "POST" && actId && action === "ratings") {
        const payload = await readBody(req);
        if (!act.participants.includes(user.id)) throw new Error("Not a member");
        if (!act.participants.includes(payload.targetId)) throw new Error("Target not in activity");
        if (payload.targetId === user.id) throw new Error("Cannot rate self");
        const scores = normalizeScores(payload.scores);
        const rating = { id: crypto.randomUUID(), raterId: user.id, targetId: payload.targetId, scores, description: payload.description || "", createdAt: new Date().toISOString() };
        act.ratings.push(rating);
        act.updatedAt = new Date().toISOString();
        await writeDb(db);
        sendJson(res, 201, { activity: await summarizeActivity(act) });
        return;
      }
      if (method === "GET" && actId && action === "ratings") {
        sendJson(res, 200, { ratings: [...act.ratings].reverse(), activity: await summarizeActivity(act) });
        return;
      }
    }

    if (url === "/api/user/profile" || url.startsWith("/api/user/profile/")) {
      if (!db.userProfiles) db.userProfiles = {};
      if (!db.userProfiles[user.id]) {
        db.userProfiles[user.id] = { displayName: user.username, bio: "", city: "", phone: "", preferences: "", createdAt: new Date().toISOString() };
        await writeDb(db);
      }
    }
    if (method === "GET" && url === "/api/user/profile") {
      sendJson(res, 200, { profile: db.userProfiles[user.id] });
      return;
    }
    if (method === "PUT" && url === "/api/user/profile") {
      const { displayName, bio, city, phone, preferences } = await readBody(req);
      if (!db.userProfiles) db.userProfiles = {};
      if (!db.userProfiles[user.id]) db.userProfiles[user.id] = { createdAt: new Date().toISOString() };
      if (displayName !== undefined) db.userProfiles[user.id].displayName = String(displayName).trim() || user.username;
      if (bio !== undefined) db.userProfiles[user.id].bio = String(bio).trim();
      if (city !== undefined) db.userProfiles[user.id].city = String(city).trim();
      if (phone !== undefined) db.userProfiles[user.id].phone = String(phone).trim();
      if (preferences !== undefined) db.userProfiles[user.id].preferences = String(preferences).trim();
      db.userProfiles[user.id].updatedAt = new Date().toISOString();
      await writeDb(db);
      sendJson(res, 200, { profile: db.userProfiles[user.id] });
      return;
    }

    if (url.startsWith("/api/")) { sendJson(res, 404, { error: "Not found" }); return; }
    serveStatic(req, res);
  } catch (error) { sendJson(res, 400, { error: error.message }); }
});

// ============ Startup ============
ensurePgDb()
  .then(() => { ensureFileDb(); server.listen(PORT, () => console.log("Server running on port " + PORT)); })
  .catch((e) => { console.error("DB init error:", e); process.exit(1); });


