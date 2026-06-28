/* ---- Constants ---- */
const ABILITIES = [
  { key: "endurance", label: "耐力" },
  { key: "strength", label: "体力" },
  { key: "technique", label: "技能" },
  { key: "safety", label: "安全意识" },
  { key: "teamwork", label: "协作" },
];
const STANDARD = { min: 1, max: 5 };

/* ---- State ---- */
var state = { token: null, user: null, activities: [], currentAct: null, currentActId: null };
var $ = function(id) { return document.getElementById(id); };

/* ---- Auth ---- */
var authView = $("authView"), appView = $("appView");
var authForm = $("authForm"), authUsername = $("authUsername"), authPassword = $("authPassword");
var authSubmit = $("authSubmit"), authError = $("authError");
var tabLogin = $("tabLogin"), tabRegister = $("tabRegister");
var userDisplay = $("userDisplay"), logoutButton = $("logoutButton");

var isLoginMode = true;
tabLogin.onclick = function() { isLoginMode = true; tabLogin.classList.add("active"); tabRegister.classList.remove("active"); authSubmit.textContent = "登录"; authError.textContent = ""; };
tabRegister.onclick = function() { isLoginMode = false; tabRegister.classList.add("active"); tabLogin.classList.remove("active"); authSubmit.textContent = "注册"; authError.textContent = ""; };

authForm.onsubmit = async function(e) {
  e.preventDefault();
  authError.textContent = "";
  var username = authUsername.value.trim(), password = authPassword.value.trim();
  if (!username || !password) { authError.textContent = "请填写用户名和密码"; return; }
  try {
    var res = await fetch(isLoginMode ? "/api/auth/login" : "/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    var data = await res.json();
    if (!res.ok) { authError.textContent = data.error || "操作失败"; return; }
    state.token = data.token; state.user = data.user;
    localStorage.setItem("outdoorToken", data.token);
    localStorage.setItem("outdoorUser", JSON.stringify(data.user));
    enterApp();
  } catch (err) { authError.textContent = "网络错误: " + err.message; }
};

logoutButton.onclick = async function() {
  try { await fetch("/api/auth/logout", { method: "POST", headers: { "authorization": "Bearer " + state.token } }); } catch {}
  state.token = null; state.user = null;
  localStorage.removeItem("outdoorToken"); localStorage.removeItem("outdoorUser");
  showAuth();
};

function showAuth() { authView.hidden = false; appView.hidden = true; authUsername.value = ""; authPassword.value = ""; authError.textContent = ""; }
function enterApp() {
  authView.hidden = true; appView.hidden = false;
  userDisplay.textContent = "用户: " + state.user.username;
  loadActivities();
}

function tryRestoreSession() {
  var token = localStorage.getItem("outdoorToken"), user = localStorage.getItem("outdoorUser");
  if (token && user) { state.token = token; state.user = JSON.parse(user); return true; }
  return false;
}
async function verifySession() {
  try {
    var res = await fetch("/api/auth/me", { headers: { "authorization": "Bearer " + state.token } });
    if (!res.ok) throw new Error("expired");
    var data = await res.json();
    state.user = data.user; localStorage.setItem("outdoorUser", JSON.stringify(data.user));
    return true;
  } catch { state.token = null; state.user = null; localStorage.removeItem("outdoorToken"); localStorage.removeItem("outdoorUser"); return false; }
}

function hdr() { return { "content-type": "application/json", "authorization": "Bearer " + state.token }; }

/* ---- View switching ---- */
function showView(id) {
  document.querySelectorAll(".page-view").forEach(function(v) { v.classList.remove("active"); });
  var el = $(id); if (el) el.classList.add("active");
}

/* ---- Activities List ---- */
var newActName = $("newActName"), createActBtn = $("createActBtn"), activitiesList = $("activitiesList");

createActBtn.onclick = async function() {
  var name = newActName.value.trim();
  if (!name) { activitiesList.innerHTML = '<p class="hint error">请输入活动名称</p>'; return; }
  try {
    var res = await fetch("/api/activities", { method: "POST", headers: hdr(), body: JSON.stringify({ name: name }) });
    var data = await res.json();
    if (!res.ok) { activitiesList.innerHTML = '<p class="hint error">' + (data.error || "创建失败") + "</p>"; return; }
    newActName.value = "";
    loadActivities();
  } catch (err) { activitiesList.innerHTML = '<p class="hint error">' + err.message + "</p>"; }
};

async function loadActivities() {
  try {
    var res = await fetch("/api/activities", { headers: hdr() });
    if (!res.ok) throw new Error("加载失败");
    var data = await res.json();
    state.activities = data.activities;
    if (!data.activities || data.activities.length === 0) {
      activitiesList.innerHTML = '<p class="hint">还没有活动，创建一个吧</p>';
      return;
    }
    activitiesList.innerHTML = data.activities.map(function(a) {
      return '<div class="act-card" data-id="' + a.id + '">' +
        '<div class="act-card-body"><h3>' + escapeHtml(a.name) + '</h3>' +
        '<span class="act-card-meta">' + a.participantCount + ' 人参与</span></div>' +
        '<div class="act-card-footer"><span>' + new Date(a.createdAt).toLocaleDateString() + "</span>" + (a.participants.some(function(p){return p.userId===state.user.id}) ? "<button class=\"btn-sm btn-enter\" onclick=\"event.stopPropagation();openActivity('"+a.id+"')\">����</button>" : "<button class=\"btn-sm\" onclick=\"event.stopPropagation();fetch('/api/activities/'+'"+a.id+"'+'/join',{method:'POST',headers:hdr()}).then(function(){loadActivities()})\">����</button>") + "</div></div>";
    }).join("");
    document.querySelectorAll(".act-card").forEach(function(card) {
      card.onclick = function() { openActivity(card.dataset.id); };
    });
  } catch (err) { activitiesList.innerHTML = '<p class="hint error">' + err.message + "</p>"; }
}

function escapeHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

/* ---- Activity Detail ---- */
var backBtn = $("backBtn"), actDetailName = $("actDetailName"), actDetailMeta = $("actDetailMeta");
var editNameBtn = $("editNameBtn"), saveNameBtn = $("saveNameBtn"), cancelEditBtn = $("cancelEditBtn");
// joinActBtn/leaveActBtn handled via event delegation
var participantsList = $("participantsList"), actStatusText = $("actStatusText");
var ratingTargetSelect = $("ratingTargetSelect"), scoreInputs = $("scoreInputs");
var ratingDesc = $("ratingDesc"), submitRatingBtn = $("submitRatingBtn");
var ratingStatus = $("ratingStatus"), radarArea = $("radarArea");
var ratingsHistory = $("ratingsHistory"), refreshRatingsBtn = $("refreshRatingsBtn");

backBtn.onclick = function() { showView("viewActivities"); loadActivities(); };

function openActivity(actId) {
  state.currentActId = actId;
  showView("viewActivity");
  loadActivityDetail();
}

async function loadActivityDetail() {
  try {
    var res = await fetch("/api/activities/" + state.currentActId, { headers: hdr() });
    if (!res.ok) throw new Error("加载活动失败");
    var data = await res.json();
    var act = data.activity;
    state.currentAct = act;
    actDetailName.textContent = act.name;
    actDetailMeta.textContent = "创建者: " + (act.createdBy === state.user.id ? "我" : "其他用户") + " | 参与者: " + act.participantCount + " 人";
    actDetailName.contentEditable = "false";
    editNameBtn.hidden = false; saveNameBtn.hidden = true; cancelEditBtn.hidden = true;

    /* Participants */
    var isIn = act.participants.some(function(p) { return p.userId === state.user.id; });
  var jb = document.getElementById('joinActBtn'); if (jb) jb.style.display = isIn ? 'none' : '';
  var lb = document.getElementById('leaveActBtn'); if (lb) lb.style.display = isIn ? '' : 'none';
    var cb = document.getElementById('cancelActBtn'); if (cb) cb.style.display = (isIn && act.createdBy === state.user.id) ? '' : 'none';
    participantsList.innerHTML = act.participants.map(function(p) {
      var scores = p.abilityScores;
      var hasScores = scores && Object.values(scores).some(function(v) { return v > 0; });
      return '<div class="part-item' + (p.userId === state.user.id ? ' me' : '') + '">' +
        '<div class="part-info">' +
        '<span class="part-name">' + escapeHtml(p.username) + (p.userId === state.user.id ? " (我)" : "") + '</span>' +
        '<span class="part-status">' + (act.averages[p.userId] ? "已评分" : "待评分") + '</span>' +
        '</div>' +
        (hasScores ? '<div class="part-abilities">' + ABILITIES.map(function(a) {
          return '<span class="abil-badge">' + a.label + ":" + (scores[a.key] || 0) + '</span>';
        }).join("") + '</div>' : '') +
        '</div>';
    }).join("")("");

    /* Rating form */
    var others = act.participants.filter(function(p) { return p.userId !== state.user.id; });
    if (isIn && others.length > 0) {
      $("ratingFormArea").style.display = "";
      ratingTargetSelect.innerHTML = others.map(function(p) {
        return '<option value="' + p.userId + '">' + escapeHtml(p.username) + "</option>";
      }).join("");
      renderScoreInputs();
    } else {
      $("ratingFormArea").style.display = "none";
    }

    /* Radar charts */
    renderRadars(act);

    /* Ratings history */
    loadRatings();
    actStatusText.textContent = "数据已同步";
  } catch (err) { participantsList.innerHTML = '<p class="hint error">' + err.message + "</p>"; }
}

/* Name editing */
editNameBtn.onclick = function() {
  actDetailName.contentEditable = "true";
  actDetailName.focus();
  editNameBtn.hidden = true; saveNameBtn.hidden = false; cancelEditBtn.hidden = false;
};
saveNameBtn.onclick = async function() {
  var name = actDetailName.textContent.trim();
  if (!name) { actDetailName.textContent = state.currentAct.name; return; }
  try {
    var res = await fetch("/api/activities/" + state.currentActId, { method: "PUT", headers: hdr(), body: JSON.stringify({ name: name }) });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || "保存失败");
    actDetailName.textContent = data.activity.name;
    state.currentAct.name = data.activity.name;
    editNameBtn.hidden = false; saveNameBtn.hidden = true; cancelEditBtn.hidden = true;
    actDetailName.contentEditable = "false";
  } catch (err) { actStatusText.textContent = err.message; }
};
cancelEditBtn.onclick = function() {
  actDetailName.textContent = state.currentAct.name;
  actDetailName.contentEditable = "false";
  editNameBtn.hidden = false; saveNameBtn.hidden = true; cancelEditBtn.hidden = true;
};

/* Join/Leave */

/* Score inputs */
function renderScoreInputs() {
  scoreInputs.innerHTML = ABILITIES.map(function(a) {
    return '<label class="range-row"><span>' + a.label + '</span>' +
      '<input name="' + a.key + '" type="range" min="' + STANDARD.min + '" max="' + STANDARD.max + '" step="1" value="3" />' +
      '<output>3</output></label>';
  }).join("");
  scoreInputs.querySelectorAll("input").forEach(function(input) {
    input.addEventListener("input", function() { input.nextElementSibling.textContent = input.value; });
  });
}

submitRatingBtn.onclick = async function() {
  var targetId = ratingTargetSelect.value;
  var desc = ratingDesc.value.trim();
  var scores = {};
  ABILITIES.forEach(function(a) { scores[a.key] = Number(scoreInputs.querySelector("[name='" + a.key + "']").value); });
  try {
    var res = await fetch("/api/activities/" + state.currentActId + "/ratings", { method: "POST", headers: hdr(), body: JSON.stringify({ targetId: targetId, scores: scores, description: desc }) });
    var data = await res.json();
    if (!res.ok) { ratingStatus.textContent = data.error || "评分失败"; return; }
    ratingStatus.textContent = "评分已保存";
    ratingDesc.value = "";
    loadActivityDetail();
  } catch (err) { ratingStatus.textContent = err.message; }
};

/* Radar charts */
function renderRadars(act) {
  if (!act.participants || act.participants.length === 0) { radarArea.innerHTML = '<p class="hint">暂无参与者</p>'; return; }
  radarArea.innerHTML = act.participants.map(function(p) {
    var avg = act.averages[p.userId];
    return '<div class="radar-card">' +
      '<div class="radar-card-header">' + escapeHtml(p.username) + '</div>' +
      '<canvas class="radar-canvas" width="300" height="300" data-user="' + p.userId + '"></canvas>' +
      '<div class="radar-scores" data-user="' + p.userId + '"></div></div>';
  }).join("");
  // Draw each radar after a small delay for canvas sizing
  setTimeout(function() {
    act.participants.forEach(function(p) {
      var canvas = radarArea.querySelector('.radar-canvas[data-user="' + p.userId + '"]');
      var scoresDiv = radarArea.querySelector('.radar-scores[data-user="' + p.userId + '"]');
      if (canvas) drawRadarChart(canvas, act.averages[p.userId], scoresDiv);
    });
  }, 50);
}

function drawRadarChart(canvas, averages, scoresDiv) {
  var ctx = canvas.getContext("2d");
  var w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!averages) { ctx.fillStyle = "#65726f"; ctx.font = "14px sans-serif"; ctx.textAlign = "center"; ctx.fillText("暂无评分", w/2, h/2); return; }

  var center = w / 2, radius = 110, levels = STANDARD.max;

  ctx.font = "13px Microsoft YaHei, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  function polarPoint(idx, r) {
    var angle = -Math.PI / 2 + (Math.PI * 2 * idx) / ABILITIES.length;
    return { x: center + Math.cos(angle) * r, y: center + Math.sin(angle) * r };
  }
  function drawPolygon(pts, opts) {
    ctx.beginPath();
    pts.forEach(function(pt, i) { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
    ctx.closePath();
    if (opts.fill) { ctx.fillStyle = opts.fill; ctx.fill(); }
    if (opts.stroke) { ctx.strokeStyle = opts.stroke; ctx.lineWidth = opts.lineWidth || 1; ctx.stroke(); }
  }

  for (var lev = levels; lev >= 1; lev--) {
    var pts = ABILITIES.map(function(_, i) { return polarPoint(i, (radius * lev) / levels); });
    drawPolygon(pts, { stroke: lev === levels ? "#91aaa0" : "#d9e1dd", fill: lev === levels ? "rgba(32,122,89,0.04)" : null });
  }
  ABILITIES.forEach(function(a, idx) {
    var edge = polarPoint(idx, radius);
    ctx.beginPath(); ctx.moveTo(center, center); ctx.lineTo(edge.x, edge.y);
    ctx.strokeStyle = "#d9e1dd"; ctx.stroke();
    var lbl = polarPoint(idx, radius + 26);
    ctx.fillStyle = "#1d2a28"; ctx.fillText(a.label, lbl.x, lbl.y);
  });

  var vpts = ABILITIES.map(function(a, idx) { return polarPoint(idx, (radius * (averages[a.key] || 0)) / STANDARD.max); });
  drawPolygon(vpts, { fill: "rgba(32,122,89,0.28)", stroke: "#207a59", lineWidth: 3 });
  vpts.forEach(function(pt) {
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#c05b46"; ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
  });

  if (scoresDiv) {
    scoresDiv.innerHTML = ABILITIES.map(function(a) {
      var val = averages[a.key] || 0;
      var pct = (val / STANDARD.max) * 100;
      return '<div class="score-item"><b><span>' + a.label + '</span><span>' + val + '</span></b>' +
        '<div class="bar"><span style="width:' + pct + '%"></span></div></div>';
    }).join("");
  }
}

/* Ratings history */
refreshRatingsBtn.onclick = loadRatings;
async function loadRatings() {
  try {
    var res = await fetch("/api/activities/" + state.currentActId + "/ratings", { headers: hdr() });
    if (!res.ok) throw new Error("加载失败");
    var data = await res.json();
    if (!data.ratings || data.ratings.length === 0) {
      ratingsHistory.innerHTML = '<p class="hint">暂无评分记录</p>';
      return;
    }
    var userMap = {};
    var act = data.activity;
    act.participants.forEach(function(p) { userMap[p.userId] = p.username; });
    ratingsHistory.innerHTML = data.ratings.map(function(r) {
      var rater = userMap[r.raterId] || "未知";
      var target = userMap[r.targetId] || "未知";
      var scores = ABILITIES.map(function(a) { return a.label + ":" + r.scores[a.key]; }).join(" ");
      var note = r.description ? '<div class="hist-note">' + escapeHtml(r.description) + "</div>" : "";
      return '<div class="hist-item"><div class="hist-body"><strong>' + escapeHtml(rater) + "</strong> 评价 <strong>" + escapeHtml(target) + "</strong><br/><span class='hist-scores'>" + scores + "</span>" + note + '<div class="hist-time">' + new Date(r.createdAt).toLocaleString() + "</div></div></div>";
    }).join("");
  } catch (err) { ratingsHistory.innerHTML = '<p class="hint error">' + err.message + "</p>"; }
}

/* ---- Boot ---- */
if (tryRestoreSession()) {
  verifySession().then(function(ok) { if (ok) enterApp(); else showAuth(); });
} else { showAuth(); }

/* Nav */ document.querySelectorAll(".main-nav-btn").forEach(function(b){b.onclick=function(){document.querySelectorAll(".main-nav-btn").forEach(function(x){x.classList.remove("active")});b.classList.add("active");document.querySelectorAll(".page-view").forEach(function(v){v.classList.remove("active")});var t=$("view"+b.dataset.page.charAt(0).toUpperCase()+b.dataset.page.slice(1));if(t)t.classList.add("active");if(b.dataset.page==="profile")loadProfile()}});

// Event delegation for join/leave buttons (dynamic DOM)
document.getElementById("appView").addEventListener("click", async function(e) {
  var actId = state.currentActId;
  if (!actId) return;
  if (e.target && e.target.id === "joinActBtn") {
    try {
      var res = await fetch("/api/activities/" + actId + "/join", { method: "POST", headers: hdr() });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || "加入失败");
      loadActivityDetail();
    } catch (err) { var st = document.getElementById("actStatusText"); if (st) st.textContent = err.message; }
  } else if (e.target && e.target.id === "leaveActBtn") {
    try {
      var res = await fetch("/api/activities/" + actId + "/leave", { method: "POST", headers: hdr() });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || "退出失败");
      showView("viewActivities");
      loadActivities();
    } catch (err) { var st2 = document.getElementById("actStatusText"); if (st2) st2.textContent = err.message; }
  }
});
/* Profile */ var pN=$("pfName"),pB=$("pfBio"),pC=$("pfCity"),pP=$("pfPhone"),pR=$("pfPrefs"),pS=$("pfSave"),pSt=$("pfStatus"); 
function renderAbilityEditor() {
  var pr = state.profile;
  if (!pr) return;
  var scores = pr.abilityScores || { endurance: 3, strength: 3, technique: 3, safety: 3, teamwork: 3 };
  var area = document.getElementById("abilityEditor");
  if (!area) return;
  area.innerHTML = ABILITIES.map(function(a) {
    var v = scores[a.key] || 3;
    return '<label class="range-row"><span>' + a.label + '</span>' +
      '<input name="pf_' + a.key + '" type="range" min="1" max="5" step="1" value="' + v + '" />' +
      '<output>' + v + '</output></label>';
  }).join("");
  area.querySelectorAll("input").forEach(function(input) {
    input.addEventListener("input", function() { input.nextElementSibling.textContent = input.value; });
  });
}

async function loadProfile(){try{var r=await fetch("/api/user/profile",{headers:hdr()});if(!r.ok)throw Error("Failed");var d=await r.json();var pr=d.profile;pN.value=pr.displayName||"";pB.value=pr.bio||"";pC.value=pr.city||"";pP.value=pr.phone||"";pR.value=pr.preferences||"";renderAbilityEditor();pSt.textContent="";pSt.className="hint"}catch(e){pSt.textContent=e.message;pSt.className="hint error"}} pS.onclick=async function(){try{var r=await fetch("/api/user/profile",{method:"PUT",headers:hdr(),body:JSON.stringify({displayName:pN.value.trim(),bio:pB.value.trim(),city:pC.value.trim(),phone:pP.value.trim(),preferences:pR.value.trim(),abilityScores:(function(){var s={};document.querySelectorAll("#abilityEditor input").forEach(function(i){s[i.name.replace("pf_","")]=Number(i.value)});return Object.keys(s).length?s:undefined})()})});var d=await r.json();if(!r.ok)throw Error(d.error||"Failed");pSt.textContent="已保存";pSt.className="hint"}catch(e){pSt.textContent=e.message;pSt.className="hint error"}};
