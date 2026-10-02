/**
 * Halaman dokumentasi publik: GET /docs
 * Hanya menampilkan alias "lunar-*", tidak pernah nama model asli.
 */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderDocs(origin, aliases) {
  const chips = aliases.map((a) => `<code class="chip">${esc(a)}</code>`).join("");
  const base = esc(origin);

  const curl = `curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "lunar-3.3-70b",
    "messages": [
      {"role": "system", "content": "Kamu asisten yang ramah."},
      {"role": "user", "content": "Halo, siapa kamu?"}
    ]
  }'`;

  const js = `const res = await fetch("${base}/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "lunar-3.1-8b",
    messages: [{ role: "user", content: "Halo!" }],
  }),
});
const data = await res.json();
console.log(data.choices[0].message.content);`;

  const py = `from openai import OpenAI

client = OpenAI(base_url="${base}/v1", api_key="YOUR_API_KEY")

resp = client.chat.completions.create(
    model="lunar-3-12b",
    messages=[{"role": "user", "content": "Jelaskan gravitasi singkat."}],
)
print(resp.choices[0].message.content)`;

  const stream = `stream = client.chat.completions.create(
    model="lunar-3-12b",
    messages=[{"role": "user", "content": "Ceritakan dongeng pendek."}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)`;

  const resp = `{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1767000000,
  "model": "lunar-3.3-70b",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Halo! ..." },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
}`;

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lunar AI API - Dokumentasi</title>
<meta name="description" content="Dokumentasi Lunar AI API, endpoint kompatibel OpenAI.">
<style>
  :root{--bg:#fff;--card:#f6f7fb;--line:#e3e6ee;--txt:#1b1f2a;--mut:#667085;--acc:#4f5df5;--code:#0f1220;--codetxt:#e6e9f5}
  @media(prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--line:#2a2f3a;--txt:#e8eaf0;--mut:#8b93a7;--acc:#8a96ff;--code:#0a0c12}}
  *{box-sizing:border-box} html{scroll-behavior:smooth;scroll-padding-top:64px}
  body{margin:0;background:var(--bg);color:var(--txt);font:16px/1.65 system-ui,sans-serif}
  nav{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;gap:18px;align-items:center;overflow-x:auto;white-space:nowrap}
  nav b{margin-right:auto} nav a{color:var(--mut);text-decoration:none;font-size:14px} nav a:hover{color:var(--acc)}
  main{max-width:820px;margin:0 auto;padding:32px 16px 80px}
  h1{font-size:32px;margin:0 0 6px} h2{font-size:22px;margin:44px 0 12px;padding-top:8px;border-top:1px solid var(--line)} h3{font-size:16px;margin:24px 0 8px}
  p{margin:8px 0} .mut{color:var(--mut)}
  code{font-family:ui-monospace,Menlo,monospace;font-size:.88em;background:var(--card);padding:2px 6px;border-radius:5px}
  pre{position:relative;background:var(--code);color:var(--codetxt);padding:16px;border-radius:10px;overflow-x:auto;margin:10px 0;line-height:1.5}
  pre code{background:none;padding:0;color:inherit;font-size:13px}
  pre button{position:absolute;top:8px;right:8px;background:#ffffff1a;color:#cfd4ea;border:0;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}
  .badge{display:inline-block;font-size:12px;font-weight:700;padding:2px 8px;border-radius:5px;margin-right:6px;color:#fff}
  .get{background:#16a34a}.post{background:#4f5df5}
  .scroll{overflow-x:auto} table{width:100%;border-collapse:collapse;min-width:520px;margin:10px 0}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);font-size:14px;vertical-align:top} th{color:var(--mut);font-weight:600}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0} .chip{padding:5px 10px;border:1px solid var(--line);background:var(--card)}
  .note{background:var(--card);border-left:3px solid var(--acc);padding:10px 14px;border-radius:6px;margin:14px 0;font-size:14.5px}
</style>
</head>
<body>
<nav>
  <b>Lunar API</b>
  <a href="#mulai">Mulai</a><a href="#auth">Autentikasi</a><a href="#models">Model</a>
  <a href="#chat">Chat</a><a href="#streaming">Streaming</a><a href="#errors">Error</a>
</nav>
<main>
  <h1>Lunar AI API</h1>
  <p class="mut">API chat kompatibel OpenAI dengan banyak model Lunar. Cukup ganti base URL di SDK atau aplikasi yang sudah ada.</p>

  <h2 id="mulai">Mulai cepat</h2>
  <p>Base URL:</p>
  <pre><code>${base}/v1</code></pre>
  <p>Kirim permintaan pertamamu:</p>
  <pre><code>${esc(curl)}</code></pre>

  <h2 id="auth">Autentikasi</h2>
  <p>Semua endpoint <code>/v1/*</code> memakai API key lewat header <code>Authorization</code>:</p>
  <pre><code>Authorization: Bearer YOUR_API_KEY</code></pre>
  <p>API key dibuat oleh admin. Jangan menaruhnya di kode frontend atau repo publik.</p>

  <h2 id="models">Model</h2>
  <p><span class="badge get">GET</span><code>/v1/models</code> menampilkan daftar model yang tersedia.</p>
  <p>Pakai nama berikut di field <code>model</code>. Format: <code>lunar-&lt;versi&gt;-&lt;ukuran&gt;</code>.</p>
  <div class="chips">${chips}</div>
  <div class="note">Model besar (mis. 70B atau 120B) lebih pintar tetapi lebih lambat dan memakai kuota lebih banyak daripada model kecil.</div>

  <h2 id="chat">Chat completions</h2>
  <p><span class="badge post">POST</span><code>/v1/chat/completions</code></p>
  <div class="scroll"><table>
    <tr><th>Parameter</th><th>Tipe</th><th>Keterangan</th></tr>
    <tr><td><code>model</code></td><td>string</td><td>Wajib. Salah satu nama model di atas.</td></tr>
    <tr><td><code>messages</code></td><td>array</td><td>Wajib. Daftar pesan dengan <code>role</code> (<code>system</code>, <code>user</code>, <code>assistant</code>) dan <code>content</code>.</td></tr>
    <tr><td><code>stream</code></td><td>boolean</td><td>Aktifkan respons streaming (SSE). Default <code>false</code>.</td></tr>
    <tr><td><code>max_tokens</code></td><td>integer</td><td>Batas token jawaban.</td></tr>
    <tr><td><code>temperature</code></td><td>number</td><td>Kreativitas jawaban, makin tinggi makin acak.</td></tr>
    <tr><td><code>top_p</code></td><td>number</td><td>Nucleus sampling.</td></tr>
    <tr><td><code>seed</code></td><td>integer</td><td>Untuk hasil yang lebih konsisten.</td></tr>
    <tr><td><code>frequency_penalty</code>, <code>presence_penalty</code></td><td>number</td><td>Mengurangi pengulangan kata.</td></tr>
  </table></div>

  <h3>Contoh respons</h3>
  <pre><code>${esc(resp)}</code></pre>

  <h3>JavaScript</h3>
  <pre><code>${esc(js)}</code></pre>
  <h3>Python (OpenAI SDK)</h3>
  <pre><code>${esc(py)}</code></pre>

  <h2 id="streaming">Streaming</h2>
  <p>Setel <code>"stream": true</code> untuk menerima jawaban bertahap lewat Server-Sent Events, dengan format sama seperti OpenAI dan diakhiri <code>data: [DONE]</code>.</p>
  <pre><code>${esc(stream)}</code></pre>

  <h2 id="errors">Error</h2>
  <p>Error dikembalikan sebagai JSON: <code>{"error": {"message": "...", "type": "..."}}</code></p>
  <div class="scroll"><table>
    <tr><th>Status</th><th>Type</th><th>Penyebab</th></tr>
    <tr><td>400</td><td><code>invalid_request_error</code></td><td>Body bukan JSON valid atau <code>messages</code> kosong.</td></tr>
    <tr><td>401</td><td><code>authentication_error</code></td><td>API key salah, dinonaktifkan, atau dihapus.</td></tr>
    <tr><td>404</td><td><code>model_not_found</code></td><td>Nama model tidak ada. Cek <code>/v1/models</code>.</td></tr>
    <tr><td>500</td><td><code>server_error</code></td><td>Gagal memproses permintaan di sisi server.</td></tr>
  </table></div>
  <p class="mut" style="margin-top:40px">Lunar AI API</p>
</main>
<script>
document.querySelectorAll("pre").forEach(function (pre) {
  var b = document.createElement("button");
  b.textContent = "Salin";
  b.onclick = function () {
    navigator.clipboard.writeText(pre.querySelector("code").textContent);
    b.textContent = "Tersalin";
    setTimeout(function () { b.textContent = "Salin"; }, 1500);
  };
  pre.appendChild(b);
});
</script>
</body>
</html>`;
}
