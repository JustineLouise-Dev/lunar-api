/**
 * Web admin untuk membuat / mencabut API key.
 * - Halaman:   GET /admin
 * - API admin: /admin/api/*  (butuh login, cookie sesi bertanda tangan HMAC)
 * - Key disimpan di KV (binding "KEYS") dalam bentuk HASH SHA-256,
 *   jadi key asli hanya tampil sekali saat dibuat.
 * - Password admin dibaca dari secret ADMIN_PASSWORD.
 */

import { limiterStub } from "./limiter.js";

const enc = new TextEncoder();
const SESSION_TTL = 12 * 60 * 60; // 12 jam

const toHex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (s) => toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

// Perbandingan waktu-konstan (hash dulu supaya panjangnya sama)
async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

const jres = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });

async function makeSession(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  return `${exp}.${await hmacHex(env.ADMIN_PASSWORD, "session:" + exp)}`;
}

async function isAuthed(request, env) {
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)lunar_admin=([^;]+)/);
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmacHex(env.ADMIN_PASSWORD, "session:" + exp));
}

const cookie = (value, maxAge) =>
  `lunar_admin=${value}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=${maxAge}`;

/** Dipakai oleh API utama untuk memvalidasi Bearer token. */
const PERIODS = ["hour", "day", "week", "month"];

/** Rapikan input limit. Angka 0 = tanpa batas. */
function cleanLimits(l = {}) {
  const num = (v) => Math.max(0, Math.min(Math.floor(Number(v)) || 0, 1e12));
  const per = (v) => (PERIODS.includes(v) ? v : "day");
  return {
    reqMax: num(l.reqMax),
    reqPeriod: per(l.reqPeriod),
    tokMax: num(l.tokMax),
    tokPeriod: per(l.tokPeriod),
  };
}

// ---- Brankas key: key asli disimpan terenkripsi agar bisa disalin dari admin ----
// Kunci enkripsi diturunkan dari ADMIN_PASSWORD. Jika password diganti, key lama
// tetap berfungsi tetapi tidak bisa disalin lagi (tombol Salin gagal).
async function vaultKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("lunar-key-vault:" + env.ADMIN_PASSWORD));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function sealKey(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await vaultKey(env), enc.encode(text));
  return toB64(iv) + "." + toB64(ct);
}

async function openKey(env, sealed) {
  const [iv, ct] = sealed.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await vaultKey(env), fromB64(ct));
  return new TextDecoder().decode(pt);
}

// Metadata untuk daftar (tanpa data terenkripsi), plus penanda bisa-disalin
const pubMeta = ({ enc: sealed, ...rest }) => ({ ...rest, copyable: !!sealed });

/** Mengembalikan { id, meta } bila key valid & aktif, selain itu null. */
export async function verifyApiKey(env, token) {
  if (!token || !env.KEYS) return null;
  const hash = await sha256Hex(token);
  const meta = await env.KEYS.get(`key:${hash}`, { type: "json", cacheTtl: 60 });
  return meta && meta.active ? { id: hash, meta } : null;
}

export async function handleAdmin(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "");

  if (!env.ADMIN_PASSWORD) {
    return jres({ error: "Secret ADMIN_PASSWORD belum diatur." }, 503);
  }

  if (path === "/admin" && request.method === "GET") {
    return new Response(PAGE, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Frame-Options": "DENY",
      },
    });
  }

  if (!path.startsWith("/admin/api")) return jres({ error: "Not found" }, 404);

  // ---- Login / logout ----
  if (path === "/admin/api/login" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!(await safeEqual(String(body.password || ""), env.ADMIN_PASSWORD))) {
      await new Promise((r) => setTimeout(r, 600)); // perlambat brute-force
      return jres({ error: "Password salah." }, 401);
    }
    return jres({ ok: true }, 200, { "Set-Cookie": cookie(await makeSession(env), SESSION_TTL) });
  }
  if (path === "/admin/api/logout" && request.method === "POST") {
    return jres({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
  }

  // ---- Semua di bawah ini butuh login ----
  if (!(await isAuthed(request, env))) return jres({ error: "Belum login." }, 401);
  if (!env.KEYS) return jres({ error: "KV binding 'KEYS' belum dikonfigurasi." }, 500);

  // Daftar key
  if (path === "/admin/api/keys" && request.method === "GET") {
    const items = [];
    let cursor;
    do {
      const page = await env.KEYS.list({ prefix: "key:", cursor });
      for (const k of page.keys) {
        if (k.metadata) items.push({ id: k.name.slice(4), ...k.metadata });
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    items.sort((a, b) => b.created - a.created);
    await Promise.all(
      items.map(async (it) => {
        try {
          it.usage = await limiterStub(env, it.id).usage(it.limits || {});
        } catch {
          it.usage = {};
        }
      })
    );
    return jres({ keys: items });
  }

  // Buat key baru
  if (path === "/admin/api/keys" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim().slice(0, 60) || "Tanpa nama";
    const raw = crypto.getRandomValues(new Uint8Array(24));
    const apiKey = "lunar-sk-" + toHex(raw);
    const id = await sha256Hex(apiKey);
    const meta = {
      name,
      created: Date.now(),
      preview: apiKey.slice(0, 13) + "…" + apiKey.slice(-4),
      active: true,
      limits: cleanLimits(body.limits),
    };
    await env.KEYS.put(`key:${id}`, JSON.stringify(meta), { metadata: meta });
    return jres({ key: apiKey, id, ...meta }, 201); // key asli hanya muncul sekali ini
  }

  // Aktif/nonaktifkan atau hapus
  const m = path.match(/^\/admin\/api\/keys\/([0-9a-f]{64})$/);
  if (m) {
    const kvKey = `key:${m[1]}`;
    if (request.method === "DELETE") {
      await env.KEYS.delete(kvKey);
      return jres({ ok: true });
    }
    if (request.method === "PATCH") {
      const body = await request.json().catch(() => ({}));
      const meta = await env.KEYS.get(kvKey, { type: "json" });
      if (!meta) return jres({ error: "Key tidak ditemukan." }, 404);
      if ("active" in body) meta.active = !!body.active;
      if (typeof body.name === "string") meta.name = body.name.trim().slice(0, 60) || meta.name;
      if (body.limits) meta.limits = cleanLimits(body.limits);
      await env.KEYS.put(kvKey, JSON.stringify(meta), { metadata: meta });
      return jres({ ok: true, active: meta.active });
    }
  }

  return jres({ error: "Not found" }, 404);
}

const PAGE = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Lunar Admin</title>
<style>
  :root{--bg:#0f1115;--card:#181b22;--line:#2a2f3a;--txt:#e8eaf0;--mut:#8b93a7;--acc:#7c8cff;--ok:#3ecf8e;--bad:#ff6b6b}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.5 system-ui,sans-serif}
  main{max-width:860px;margin:0 auto;padding:32px 16px}
  h1{font-size:22px;margin:0 0 4px} p.sub{color:var(--mut);margin:0 0 24px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:20px}
  input{width:100%;padding:10px 12px;background:var(--bg);border:1px solid var(--line);border-radius:8px;color:var(--txt);font:inherit}
  input:focus{outline:2px solid var(--acc);border-color:transparent}
  button{padding:9px 14px;border:0;border-radius:8px;background:var(--acc);color:#0b0d12;font:inherit;font-weight:600;cursor:pointer}
  button.ghost{background:transparent;color:var(--txt);border:1px solid var(--line)}
  button.danger{background:transparent;color:var(--bad);border:1px solid var(--line)}
  .row{display:flex;gap:10px} .row input{flex:1}
  .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
  .err{color:var(--bad);margin:10px 0 0;min-height:1.2em}
  .newkey{border-color:var(--ok)} .newkey code{display:block;word-break:break-all;background:var(--bg);padding:12px;border-radius:8px;margin:10px 0;user-select:all}
  .scroll{overflow-x:auto} table{width:100%;border-collapse:collapse;min-width:560px}
  th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);font-size:14px} th{color:var(--mut);font-weight:500}
  td.act{white-space:nowrap;display:flex;gap:6px}
  .tag{padding:2px 8px;border-radius:99px;font-size:12px} .on{background:#12372a;color:var(--ok)} .off{background:#3a1d1d;color:var(--bad)}
  .hide{display:none} .mut{color:var(--mut)} code{font-family:ui-monospace,monospace;font-size:13px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:14px 0}
  @media(max-width:640px){.grid{grid-template-columns:1fr}}
  label{display:block;font-size:14px} label .row{margin-top:6px}
  select{padding:10px;background:var(--bg);color:var(--txt);border:1px solid var(--line);border-radius:8px;font:inherit}
  .usage{white-space:pre-line;font-size:13px;color:var(--mut)}
</style>
</head>
<body>
<main>
  <section id="login" class="hide">
    <h1>Lunar Admin</h1><p class="sub">Masukkan password untuk melanjutkan.</p>
    <form id="loginForm" class="card">
      <input id="pw" type="password" placeholder="Password" autocomplete="current-password" autofocus>
      <div class="err" id="loginErr"></div>
      <button type="submit">Masuk</button>
    </form>
  </section>

  <section id="panel" class="hide">
    <div class="top">
      <div><h1>Lunar Admin</h1><div class="mut">Kelola API key</div></div>
      <button class="ghost" id="logout">Keluar</button>
    </div>

    <form id="createForm" class="card">
      <input id="keyName" placeholder="Nama key (mis. Aplikasi Bot)" maxlength="60">
      <div class="grid">
        <label>Limit request <span class="mut">(0 = tanpa batas)</span>
          <div class="row">
            <input id="reqMax" type="number" min="0" value="0">
            <select id="reqPeriod"><option value="hour">per jam</option><option value="day" selected>per hari</option><option value="week">per minggu</option><option value="month">per bulan</option></select>
          </div>
        </label>
        <label>Limit token <span class="mut">(0 = tanpa batas)</span>
          <div class="row">
            <input id="tokMax" type="number" min="0" value="0">
            <select id="tokPeriod"><option value="hour">per jam</option><option value="day" selected>per hari</option><option value="week">per minggu</option><option value="month">per bulan</option></select>
          </div>
        </label>
      </div>
      <div class="row">
        <button type="submit" id="saveBtn">Buat key</button>
        <button type="button" class="ghost hide" id="cancelEdit">Batal</button>
      </div>
      <div class="err" id="createErr"></div>
    </form>

    <div id="newKeyBox" class="card newkey hide">
      <strong>Key baru berhasil dibuat</strong>
      <code id="newKey"></code>
      <div class="mut">Simpan sekarang. Key ini tidak akan ditampilkan lagi.</div>
      <p><button id="copyBtn" class="ghost">Salin</button></p>
    </div>

    <div class="card scroll">
      <table>
        <thead><tr><th>Nama</th><th>Key</th><th>Dibuat</th><th>Status</th><th>Limit &amp; pemakaian</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
      <div id="empty" class="mut hide" style="padding-top:12px">Belum ada API key.</div>
    </div>
  </section>
</main>

<script>
var $ = function (s) { return document.querySelector(s); };

function show(which) {
  $("#login").classList.toggle("hide", which !== "login");
  $("#panel").classList.toggle("hide", which !== "panel");
}

async function api(path, opts) {
  opts = opts || {};
  var r = await fetch("/admin/api" + path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin"
  });
  var data = await r.json().catch(function () { return {}; });
  if (r.status === 401 && path !== "/login") { show("login"); throw new Error("Sesi berakhir, silakan login lagi."); }
  if (!r.ok) throw new Error(data.error || "Terjadi kesalahan");
  return data;
}

function cell(tr, text, cls) {
  var td = document.createElement("td");
  if (cls) td.className = cls;
  td.textContent = text;
  tr.appendChild(td);
  return td;
}

function btn(label, cls, fn) {
  var b = document.createElement("button");
  b.textContent = label; b.className = cls; b.onclick = fn;
  return b;
}

async function load() {
  var d = await api("/keys");
  var tbody = $("#rows");
  tbody.textContent = "";
  $("#empty").classList.toggle("hide", d.keys.length > 0);
  d.keys.forEach(function (k) {
    var tr = document.createElement("tr");
    cell(tr, k.name);
    var kt = cell(tr, ""); var c = document.createElement("code"); c.textContent = k.preview; kt.appendChild(c);
    cell(tr, new Date(k.created).toLocaleString("id-ID"));
    var st = cell(tr, ""); var tag = document.createElement("span");
    tag.className = "tag " + (k.active ? "on" : "off"); tag.textContent = k.active ? "Aktif" : "Nonaktif"; st.appendChild(tag);
    cell(tr, usageText(k), "usage");
    var act = document.createElement("td"); act.className = "act";
    act.appendChild(btn(k.active ? "Nonaktifkan" : "Aktifkan", "ghost", async function () {
      await api("/keys/" + k.id, { method: "PATCH", body: { active: !k.active } }); load();
    }));
    act.appendChild(btn("Edit", "ghost", function () { startEdit(k); }));
    act.appendChild(btn("Hapus", "danger", async function () {
      if (!confirm("Hapus key \\"" + k.name + "\\"? Tindakan ini permanen.")) return;
      await api("/keys/" + k.id, { method: "DELETE" }); load();
    }));
    tr.appendChild(act);
    tbody.appendChild(tr);
  });
}

$("#loginForm").onsubmit = async function (e) {
  e.preventDefault();
  $("#loginErr").textContent = "";
  try {
    await api("/login", { method: "POST", body: { password: $("#pw").value } });
    $("#pw").value = ""; show("panel"); load();
  } catch (err) { $("#loginErr").textContent = err.message; }
};

var PN = { hour: "jam", day: "hari", week: "minggu", month: "bulan" };
var editId = null;

function fmt(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n); }

function usageText(k) {
  var u = k.usage || {}, L = k.limits || {};
  return "Req: " + (u.reqUsed || 0) + " / " + (L.reqMax ? L.reqMax + " per " + PN[L.reqPeriod] : "tanpa batas") +
    "\\nToken: " + fmt(u.tokUsed || 0) + " / " + (L.tokMax ? fmt(L.tokMax) + " per " + PN[L.tokPeriod] : "tanpa batas");
}

function formLimits() {
  return {
    reqMax: Number($("#reqMax").value) || 0, reqPeriod: $("#reqPeriod").value,
    tokMax: Number($("#tokMax").value) || 0, tokPeriod: $("#tokPeriod").value
  };
}

function resetForm() {
  editId = null;
  $("#keyName").value = ""; $("#reqMax").value = 0; $("#tokMax").value = 0;
  $("#reqPeriod").value = "day"; $("#tokPeriod").value = "day";
  $("#saveBtn").textContent = "Buat key";
  $("#cancelEdit").classList.add("hide");
}

function startEdit(k) {
  var L = k.limits || {};
  editId = k.id;
  $("#keyName").value = k.name;
  $("#reqMax").value = L.reqMax || 0; $("#reqPeriod").value = L.reqPeriod || "day";
  $("#tokMax").value = L.tokMax || 0; $("#tokPeriod").value = L.tokPeriod || "day";
  $("#saveBtn").textContent = "Simpan perubahan";
  $("#cancelEdit").classList.remove("hide");
  window.scrollTo(0, 0); $("#keyName").focus();
}

$("#cancelEdit").onclick = resetForm;

$("#createForm").onsubmit = async function (e) {
  e.preventDefault();
  $("#createErr").textContent = "";
  try {
    var body = { name: $("#keyName").value, limits: formLimits() };
    if (editId) {
      await api("/keys/" + editId, { method: "PATCH", body: body });
      resetForm();
    } else {
      var d = await api("/keys", { method: "POST", body: body });
      resetForm();
      $("#newKey").textContent = d.key;
      $("#newKeyBox").classList.remove("hide");
    }
    load();
  } catch (err) { $("#createErr").textContent = err.message; }
};

$("#copyBtn").onclick = async function () {
  await navigator.clipboard.writeText($("#newKey").textContent);
  $("#copyBtn").textContent = "Tersalin";
  setTimeout(function () { $("#copyBtn").textContent = "Salin"; }, 1500);
};

$("#logout").onclick = async function () {
  await api("/logout", { method: "POST" }); $("#newKeyBox").classList.add("hide"); show("login");
};

// Cek apakah sesi masih valid
api("/keys").then(function () { show("panel"); load(); }).catch(function () { show("login"); });
</script>
</body>
</html>`;
