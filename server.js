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
  { key: "endurance", label: "耐力" },
  { key: "strength", label: "体力" },
  { key: "technique", label: "技能" },
  { key: "safety", label: "安全意识" },
  { key: "teamwork", label: "协作" },
];
const SCORE_MIN = 1;
const SCORE_MAX = 5;

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    let seed = {
      version: 2,
      standard: { min: SCORE_MIN, max: SCORE_MAX, abilities: ABILITIES },
      users: [], sessions: {}, activities: {}, userProfiles: {},
      updatedAt: new Date().toISOString(),
    };
    writeDb(seed);
  }
}
function readDb() { ensureDb(); return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); }
function writeDb(db) {
  db.updatedAt = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + "\n", "utf8");
}

function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64).toString("hex"); }
function generateSalt() { return crypto.randomBytes(16).toString("hex"); }
function makeUserId() { return "usr_" + crypto.randomBytes(8).toString("hex"); }
function makeSessionToken() { return crypto.randomUUID() + crypto.randomUUID(); }
function makeActId() { return "act_" + crypto.randomBytes(8).toString("hex"); }
function getAuthUser(db, req) {
  const a = (req.headers["authorization"] || "").match(/^Bearer\s+(.+)$/i);
  if (!a) return null;
  const s = db.sessions[a[1]];
  return s ? (db.users.find((u) => u.id === s.userId) || null) : null;
}
function normalizeScores(input) {
  const scores = {};
  for (const a of ABILITIES) {
    const v = Number(input?.[a.key]);
    if (!Number.isInteger(v) || v < SCORE_MIN || v > SCORE_MAX)
      throw new Error(a.label + " must be " + SCORE_MIN + "-" + SCORE_MAX);
    scores[a.key] = v;
  }
  return scores; // test
}
function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}
function serveStatic(req, res) {
  const parsed = urlModule.parse(req.url);
  const requested = parsed.pathname === "/" ? "/index.html" : decodeURIComponent(parsed.pathname);
  const fp = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const mime = (ext) => ext === ".html" ? "text/html; charset=utf-8"
                    : ext === ".css" ? "text/css; charset=utf-8"
                    : ext === ".js" ? "text/javascript; charset=utf-8"
                    : "application/octet-stream";
    res.writeHead(200, { "content-type": mime(path.extname(fp)) });
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

function summarizeActivity(act) {
  const db = readDb();
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
    averages[pid] = Object.fromEntries(
      ABILITIES.map((a) => [a.key, Number((totals[a.key] / related.length).toFixed(2))])
    );
  }
  return {
    id: act.id, name: act.name, createdBy: act.createdBy,
    createdAt: act.createdAt,
    participants, participantCount: act.participants.length,
    ratings: act.ratings,
    averages, updatedAt: act.updatedAt,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const db = readDb();
    const user = getAuthUser(db, req);
    const parsedUrl = urlModule.parse(req.url);
    const method = req.method;
    const url = parsedUrl.pathname;

    if (method === "POST" && url === "/api/auth/register") {
      const { username, password } = await readBody(req);
      if (!username || !password || String(username).length < 2 || String(password).length < 4)
        throw new Error("Invalid username/password");
      if (db.users.find((u) => u.username === username)) throw new Error("Username taken");
      const salt = generateSalt();
      const ue = { id: makeUserId(), username, passwordHash: hashPassword(password, salt), salt, createdAt: new Date().toISOString() };
      db.users.push(ue);
      const token = makeSessionToken();
      db.sessions[token] = { userId: ue.id, createdAt: new Date().toISOString() };
      writeDb(db);
      sendJson(res, 201, { token, user: { id: ue.id, username: ue.username } });
      return;
    }
    if (method === "POST" && url === "/api/auth/login") {
      const { username, password } = await readBody(req);
      const ue = db.users.find((u) => u.username === username);
      if (!ue || hashPassword(password, ue.salt) !== ue.passwordHash) throw new Error("Bad credentials");
      const token = makeSessionToken();
      db.sessions[token] = { userId: ue.id, createdAt: new Date().toISOString() };
      writeDb(db);
      sendJson(res, 200, { token, user: { id: ue.id, username: ue.username } });
      return;
    }
    if (method === "POST" && url === "/api/auth/logout") {
      const m = (req.headers["authorization"] || "").match(/^Bearer\s+(.+)$/i);
      if (m) delete db.sessions[m[1]];
      writeDb(db); sendJson(res, 200, { ok: true }); return;
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
        const list = Object.values(db.activities)
          .filter((a) => a.participants.includes(user.id))
          .map((a) => summarizeActivity(a));
        sendJson(res, 200, { activities: list.reverse() });
        return;
      }
      if (method === "POST" && !actId) {
        const { name } = await readBody(req);
        if (!name || String(name).trim().length === 0) throw new Error("Name required");
        const act = {
          id: makeActId(), name: String(name).trim(),
          createdBy: user.id, createdAt: new Date().toISOString(),
          participants: [user.id], ratings: [], updatedAt: new Date().toISOString(),
        };
        db.activities[act.id] = act;
        writeDb(db);
        sendJson(res, 201, { activity: summarizeActivity(act) });
        return;
      }
      if (!actId || !db.activities[actId]) { sendJson(res, 404, { error: "Not found" }); return; }
      const act = db.activities[actId];

      if (method === "GET" && actId && !action) {
        if (!act.participants.includes(user.id)) throw new Error("Not a member");
        sendJson(res, 200, { activity: summarizeActivity(act) });
        return;
      }
      if (method === "PUT" && actId && !action) {
        const { name } = await readBody(req);
        if (!name || String(name).trim().length === 0) throw new Error("Name required");
        act.name = String(name).trim();
        act.updatedAt = new Date().toISOString();
        writeDb(db);
        sendJson(res, 200, { activity: summarizeActivity(act) });
        return;
      }
      if (method === "POST" && actId && action === "join") {
        if (act.participants.includes(user.id)) throw new Error("Already joined");
        act.participants.push(user.id);
        act.updatedAt = new Date().toISOString();
        writeDb(db);
        sendJson(res, 200, { activity: summarizeActivity(act) });
        return;
      }
      if (method === "POST" && actId && action === "leave") {
        const idx = act.participants.indexOf(user.id);
        if (idx === -1) throw new Error("Not a member");
        act.participants.splice(idx, 1);
        act.updatedAt = new Date().toISOString();
        writeDb(db);
        sendJson(res, 200, { activity: summarizeActivity(act) });
        return;
      }
      if (method === "POST" && actId && action === "ratings") {
        const payload = await readBody(req);
        if (!act.participants.includes(user.id)) throw new Error("Not a member");
        if (!act.participants.includes(payload.targetId)) throw new Error("Target not in activity");
        if (payload.targetId === user.id) throw new Error("Cannot rate self");
        const scores = normalizeScores(payload.scores);
        const rating = {
          id: crypto.randomUUID(), raterId: user.id,
          targetId: payload.targetId,
          scores, description: payload.description || "",
          createdAt: new Date().toISOString(),
        };
        act.ratings.push(rating);
        act.updatedAt = new Date().toISOString();
        writeDb(db);
        sendJson(res, 201, { activity: summarizeActivity(act) });
        return;
      }
      if (method === "GET" && actId && action === "ratings") {
        sendJson(res, 200, { ratings: [...act.ratings].reverse(), activity: summarizeActivity(act) });
        return;
      }
    }

    
    if (url.startsWith("/api/user/profile")) {
      if (!db.userProfiles) db.userProfiles = {};
      if (!db.userProfiles[user.id]) {
        db.userProfiles[user.id] = { displayName: user.username, bio: "", city: "", phone: "", preferences: "", createdAt: new Date().toISOString() };
        writeDb(db);
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
      writeDb(db);
      sendJson(res, 200, { profile: db.userProfiles[user.id] });
      return;
    }

    if (url.startsWith("/api/")) { sendJson(res, 404, { error: "Not found" }); return; }
    serveStatic(req, res);
  } catch (error) { sendJson(res, 400, { error: error.message }); }
});

ensureDb();
server.listen(PORT, () => { console.log("Server running on port " + PORT); });