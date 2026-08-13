/* TeachingMatrix — shared core: CSV, GitHub API, diffing, rendering.
   No dependencies. Used by index.html (contributors) and maintain.html (maintainers). */
"use strict";

/* ---------------- CSV ---------------- */
const CSV = {
  parse(text) {
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    // drop trailing fully-empty rows
    while (rows.length && rows[rows.length - 1].every(f => f === "")) rows.pop();
    return rows;
  },
  field(s) {
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  },
  serialize(rows) {
    return rows.map(r => r.map(CSV.field).join(",")).join("\n") + "\n";
  },
};

/* ---------------- Matrix model ----------------
   A matrix = { header:[...], rows:[[...]], keyN:int }
   Columns [0, keyN) are key columns (Category, Topic / Category, ID, Sub-topic);
   columns [keyN, ...) are courses. Row key = key cells joined with "\x1f". */
function toMatrix(rows, keyN) {
  return { header: rows[0], rows: rows.slice(1), keyN };
}
function matrixRows(m) { return [m.header, ...m.rows]; }
function rowKey(m, row) { return row.slice(0, m.keyN).join("\x1f"); }
function rowLabel(m, row) { return row.slice(1, m.keyN).join(" "); }
function cloneMatrix(m) {
  return { header: [...m.header], rows: m.rows.map(r => [...r]), keyN: m.keyN };
}

/* Cell-level diff between two matrices (same keyN). Returns
   { cells:[{key,label,col,old,new}], addedRows:[label], removedRows:[label],
     addedCols:[name], removedCols:[name] } */
function diffMatrices(a, b) {
  const out = { cells: [], addedRows: [], removedRows: [], addedCols: [], removedCols: [] };
  const aCols = a.header.slice(a.keyN), bCols = b.header.slice(b.keyN);
  out.addedCols = bCols.filter(c => !aCols.includes(c));
  out.removedCols = aCols.filter(c => !bCols.includes(c));
  const aMap = new Map(a.rows.map(r => [rowKey(a, r), r]));
  const bMap = new Map(b.rows.map(r => [rowKey(b, r), r]));
  for (const [k, br] of bMap) {
    const ar = aMap.get(k);
    const label = br.slice(1, b.keyN).join(" ") || br[0];
    if (!ar) { out.addedRows.push(label); }
    for (const col of bCols) {
      const bi = b.header.indexOf(col);
      const nv = (br[bi] || "").trim();
      let ov = "";
      if (ar) {
        const ai = a.header.indexOf(col);
        ov = ai >= 0 ? (ar[ai] || "").trim() : "";
      }
      if (nv !== ov) out.cells.push({ key: k, label, col, old: ov, new: nv });
    }
  }
  for (const [k, ar] of aMap) {
    if (!bMap.has(k)) out.removedRows.push(ar.slice(1, a.keyN).join(" ") || ar[0]);
  }
  return out;
}

/* ---------------- GitHub API ---------------- */
const GH = {
  token: null, apiBase: "https://api.github.com",
  headers() {
    const h = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (GH.token) h.Authorization = "Bearer " + GH.token;
    return h;
  },
  async req(path, opts = {}) {
    const r = await fetch(GH.apiBase + path, {
      method: opts.method || "GET",
      headers: { ...GH.headers(), ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (r.status === 204) return null;
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data && data.message ? data.message : r.status;
      const err = new Error(`GitHub API ${r.status}: ${msg} (${path})`);
      err.status = r.status; err.data = data;
      throw err;
    }
    return data;
  },
  user()               { return GH.req("/user"); },
  repo(o, r)           { return GH.req(`/repos/${o}/${r}`); },
  branch(o, r, b)      { return GH.req(`/repos/${o}/${r}/branches/${encodeURIComponent(b)}`); },
  async fileAt(o, r, path, ref) {
    const d = await GH.req(`/repos/${o}/${r}/contents/${path}?ref=${encodeURIComponent(ref)}`);
    const bytes = Uint8Array.from(atob(d.content.replace(/\n/g, "")), c => c.charCodeAt(0));
    return { text: new TextDecoder("utf-8").decode(bytes), sha: d.sha };
  },
  createBranch(o, r, name, fromSha) {
    return GH.req(`/repos/${o}/${r}/git/refs`, { method: "POST", body: { ref: `refs/heads/${name}`, sha: fromSha } });
  },
  putFile(o, r, path, branch, text, message, sha) {
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
    return GH.req(`/repos/${o}/${r}/contents/${path}`, {
      method: "PUT", body: { message, content: b64, branch, ...(sha ? { sha } : {}) },
    });
  },
  createPR(o, r, head, base, title, body) {
    return GH.req(`/repos/${o}/${r}/pulls`, { method: "POST", body: { head, base, title, body } });
  },
  listPRs(o, r, state = "open") {
    return GH.req(`/repos/${o}/${r}/pulls?state=${state}&per_page=100&sort=created&direction=desc`);
  },
  pr(o, r, n)          { return GH.req(`/repos/${o}/${r}/pulls/${n}`); },
  prReviews(o, r, n)   { return GH.req(`/repos/${o}/${r}/pulls/${n}/reviews?per_page=100`); },
  prFiles(o, r, n)     { return GH.req(`/repos/${o}/${r}/pulls/${n}/files?per_page=100`); },
  mergePR(o, r, n, method = "squash") {
    return GH.req(`/repos/${o}/${r}/pulls/${n}/merge`, { method: "PUT", body: { merge_method: method } });
  },
  closePR(o, r, n)     { return GH.req(`/repos/${o}/${r}/pulls/${n}`, { method: "PATCH", body: { state: "closed" } }); },
  review(o, r, n, event, body = "") {
    return GH.req(`/repos/${o}/${r}/pulls/${n}/reviews`, { method: "POST", body: { event, body } });
  },
  comment(o, r, n, body) {
    return GH.req(`/repos/${o}/${r}/issues/${n}/comments`, { method: "POST", body: { body } });
  },
  commits(o, r, path, per = 50) {
    return GH.req(`/repos/${o}/${r}/commits?path=${encodeURIComponent(path)}&per_page=${per}`);
  },
  tags(o, r)           { return GH.req(`/repos/${o}/${r}/tags?per_page=100`); },
  branches(o, r)       { return GH.req(`/repos/${o}/${r}/branches?per_page=100`); },
};

/* ---------------- Config / settings ---------------- */
const Settings = {
  get token()  { return localStorage.getItem("tm_token") || ""; },
  set token(v) { v ? localStorage.setItem("tm_token", v) : localStorage.removeItem("tm_token"); },
  get repoOverride()  { return localStorage.getItem("tm_repo") || ""; },
  set repoOverride(v) { v ? localStorage.setItem("tm_repo", v) : localStorage.removeItem("tm_repo"); },
};

async function loadConfig() {
  let cfg = {};
  try { cfg = await (await fetch("config.json", { cache: "no-store" })).json(); } catch (e) { /* fall through */ }
  // Auto-detect owner/repo when served from GitHub Pages
  const host = location.hostname;
  if (host.endsWith(".github.io")) {
    const owner = host.split(".")[0];
    const seg = location.pathname.split("/").filter(Boolean);
    if (!cfg.owner || cfg.owner === "YOUR_GITHUB_USERNAME") cfg.owner = owner;
    if ((!cfg.repo || cfg.repo === "YOUR_REPO") && seg.length) cfg.repo = seg[0];
  }
  const ov = Settings.repoOverride;             // "owner/repo" manual override
  if (ov && ov.includes("/")) [cfg.owner, cfg.repo] = ov.split("/");
  cfg.baseBranch = cfg.baseBranch || "main";
  cfg.branchPrefix = cfg.branchPrefix || "matrix-edit/";
  cfg.levels = cfg.levels || ["", "I", "D", "E"];
  cfg.datasets = cfg.datasets || [
    { id: "coarse", label: "Coarse matrix", path: "data/matrix.csv", keyCols: 2 },
    { id: "granular", label: "Granular matrix", path: "data/granular.csv", keyCols: 3 },
  ];
  return cfg;
}

/* ---------------- Rendering helpers ---------------- */
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}
function levelClass(v) { return v === "E" ? "lv-E" : v === "D" ? "lv-D" : v === "I" ? "lv-I" : "lv-blank"; }
function fmtDate(s) { return new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }

/* Render a matrix into a container as an interactive/static table.
   opts: { editable, edits(Map key\x1fcol -> newVal), onCell(key,col,rowIdx,colName),
           highlight(Map same-key -> {old,new}) } */
function renderMatrix(container, m, opts = {}) {
  container.textContent = "";
  const table = el("table", { class: "matrix" });
  const thead = el("thead");
  const hr = el("tr");
  for (let i = 0; i < m.keyN; i++)
    hr.append(el("th", { class: "key-col hdr" + (i === m.keyN - 1 ? " key-sticky" : " key-narrow") },
      i === 0 ? "" : m.header[i]));   // Category header cell left blank (categories render as separator bars)
  for (let i = m.keyN; i < m.header.length; i++) {
    const th = el("th", { class: "course-col hdr" }, el("div", { class: "vert" }, m.header[i]));
    if (opts.newCols && opts.newCols.has(m.header[i])) th.classList.add("added");
    hr.append(th);
  }
  thead.append(hr); table.append(thead);
  const tbody = el("tbody");
  let lastCat = null;
  m.rows.forEach((row, ri) => {
    const cat = row[0];
    if (cat !== lastCat) {
      lastCat = cat;
      tbody.append(el("tr", { class: "cat-row" },
        el("td", { colspan: String(m.header.length) },
          el("span", { class: "cat-label" }, cat))));
    }
    const tr = el("tr", { "data-key": rowKey(m, row) });
    if (opts.newRows && opts.newRows.has(rowKey(m, row))) tr.classList.add("added-row");
    tr.append(el("td", { class: "key-col key-narrow cat-cell" }, ""));  // category column placeholder
    for (let i = 1; i < m.keyN; i++)
      tr.append(el("td", { class: "key-col" + (i === m.keyN - 1 ? " key-sticky" : " key-narrow") }, row[i]));
    for (let i = m.keyN; i < m.header.length; i++) {
      const col = m.header[i], key = rowKey(m, row);
      const ek = key + "\x1f" + col;
      let val = (row[i] || "").trim();
      const td = el("td", { class: "cell " + levelClass(val) }, val);
      if (opts.edits && opts.edits.has(ek)) {
        const nv = opts.edits.get(ek);
        td.textContent = nv; td.className = "cell edited " + levelClass(nv);
        td.title = `was: ${val || "(blank)"}`;
      }
      if (opts.highlight && opts.highlight.has(ek)) {
        const { old: ov, new: nv } = opts.highlight.get(ek);
        td.className = "cell diff " + levelClass(nv);
        td.textContent = ""; td.append(
          el("span", { class: "old " + levelClass(ov) }, ov || "·"), " → ",
          el("span", { class: "new" }, nv || "·"));
      }
      if (opts.editable) {
        td.classList.add("clickable");
        td.addEventListener("click", () => opts.onCell(key, col, ri, i));
      }
      tr.append(td);
    }
    tbody.append(tr);
  });
  table.append(tbody);
  container.append(table);
  return table;
}

/* Change-summary markdown for PR bodies (+ machine-readable JSON in a comment) */
function changesToMarkdown(dsLabel, diff) {
  const lines = [`### Teaching-matrix change request — ${dsLabel}`, ""];
  if (diff.addedCols.length)   lines.push(`**New course columns:** ${diff.addedCols.join(", ")}`, "");
  if (diff.removedCols.length) lines.push(`**Removed course columns:** ${diff.removedCols.join(", ")}`, "");
  if (diff.addedRows.length)   lines.push(`**New topics:** ${diff.addedRows.join("; ")}`, "");
  if (diff.removedRows.length) lines.push(`**Removed topics:** ${diff.removedRows.join("; ")}`, "");
  if (diff.cells.length) {
    lines.push("| Topic | Course | Change |", "|---|---|---|");
    for (const c of diff.cells.slice(0, 200))
      lines.push(`| ${c.label} | ${c.col} | ${c.old || "·"} → ${c.new || "·"} |`);
    if (diff.cells.length > 200) lines.push(`| … | | ${diff.cells.length - 200} more |`);
  }
  lines.push("", "_Submitted via the TeachingMatrix editor._");
  return lines.join("\n");
}

/* PR status decoration: reviews → approved/changes_requested */
async function prStatus(o, r, pr) {
  let reviewState = "";
  try {
    const reviews = await GH.prReviews(o, r, pr.number);
    const latest = {};
    for (const rv of reviews) if (["APPROVED", "CHANGES_REQUESTED"].includes(rv.state)) latest[rv.user.login] = rv.state;
    const states = Object.values(latest);
    if (states.includes("CHANGES_REQUESTED")) reviewState = "changes requested";
    else if (states.includes("APPROVED")) reviewState = "approved";
  } catch (e) { /* ignore */ }
  return reviewState;
}
function prBadge(pr) {
  if (pr.merged_at) return el("span", { class: "badge merged" }, "merged");
  if (pr.state === "closed") return el("span", { class: "badge closed" }, "closed");
  return el("span", { class: "badge open" }, "open");
}
