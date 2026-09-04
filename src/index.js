// VibeAudit Scan — GitHub Action (no dependencies, no build step: this file is the whole action).
// 1. Get the workflow's OIDC token (proves which repo is calling; no API key needed).
// 2. Ask vibeaudit.sh to run a free quick scan of this public repo (one per repo per day; repeats reuse the report).
// 3. Poll until done, write a job summary, optionally upsert a PR comment, optionally fail below a score.
const fs = require("node:fs");

const SITE = process.env.VIBEAUDIT_SITE || "https://vibeaudit.sh";
// GitHub exposes inputs as INPUT_<NAME> with the name upper-cased and hyphens kept (INPUT_FAIL-BELOW).
const input = (name, def) => (process.env[`INPUT_${name.toUpperCase()}`] ?? def).trim();
const log = (m) => console.log(m);
const fail = (m) => { console.log(`::error::${m}`); process.exit(1); };
const setOutput = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const summary = (md) => { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function oidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, tok = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !tok) fail("No OIDC token available. Add `permissions: id-token: write` to the job.");
  const r = await fetch(`${url}&audience=vibeaudit.sh`, { headers: { authorization: `Bearer ${tok}` } });
  if (!r.ok) fail(`Could not get OIDC token: HTTP ${r.status}`);
  return (await r.json()).value;
}

function render(audit) {
  const q = audit.quickReport || {};
  const score = audit.score ?? q.score;
  const emoji = score >= 90 ? "🟢" : score >= 70 ? "🟡" : "🔴";
  const label = q.readiness === "ship_it" ? "SHIP IT" : q.readiness === "fix_first" ? "FIX FIRST" : "NOT READY";
  const order = ["critical", "high", "medium", "low", "info"];
  const findings = [...(q.findings || [])].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  const top = findings.slice(0, 5).map((f) => `- **${f.severity.toUpperCase()}** ${f.title}${f.verified ? " ✓" : ""}`).join("\n");
  const url = `${SITE}/a/${audit.id}?src=action`;
  return `<!-- vibeaudit-scan -->
### ${emoji} VibeAudit: **${score}/100** · ${label}

${q.summary ? q.summary.split(/(?<=\.)\s/).slice(0, 2).join(" ") : ""}

${top || "_No findings in the highest-risk files._"}

${findings.length > 5 ? `…and ${findings.length - 5} more. ` : ""}[Full report with fix prompts →](${url})

<sub>Quick scan of the highest-risk files. Findings marked ✓ were re-verified against the code by a second model. <a href="${SITE}">vibeaudit.sh</a></sub>`;
}

async function upsertComment(body) {
  const token = input("github-token", "");
  const repo = process.env.GITHUB_REPOSITORY;
  let pr = null;
  try { pr = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).pull_request?.number ?? null; } catch {}
  if (!token || !repo || !pr) { log("No pull request context; skipping comment."); return; }
  const H = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "vibeaudit-action" };
  const list = await fetch(`https://api.github.com/repos/${repo}/issues/${pr}/comments?per_page=100`, { headers: H });
  const existing = list.ok ? (await list.json()).find((c) => typeof c.body === "string" && c.body.includes("<!-- vibeaudit-scan -->")) : null;
  const r = existing
    ? await fetch(`https://api.github.com/repos/${repo}/issues/comments/${existing.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ body }) })
    : await fetch(`https://api.github.com/repos/${repo}/issues/${pr}/comments`, { method: "POST", headers: H, body: JSON.stringify({ body }) });
  if (!r.ok) log(`::warning::Could not post PR comment (HTTP ${r.status}). Does the job have \`pull-requests: write\`?`);
  else log(existing ? "Updated PR comment." : "Posted PR comment.");
}

(async () => {
  const token = await oidcToken();
  const start = await fetch(`${SITE}/api/action/scan`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
  const started = await start.json().catch(() => ({}));
  if (!start.ok) fail(started.error || `VibeAudit returned HTTP ${start.status}`);
  log(`${started.reused ? "Reusing today's report" : "Scan started"}: ${started.url}`);

  let audit = null;
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const r = await fetch(`${SITE}/api/audit/${started.id}?cb=${Date.now()}`);
    if (!r.ok) continue;
    audit = await r.json();
    if (audit.status === "done" || audit.status === "error") break;
  }
  if (!audit || audit.status !== "done") fail(`Scan did not finish: ${audit?.error || "timeout"}`);

  const md = render(audit);
  summary(md);
  setOutput("score", String(audit.score));
  setOutput("report-url", `${SITE}/a/${audit.id}?src=action`);
  log(`Score ${audit.score}/100 — ${SITE}/a/${audit.id}`);
  if (input("comment", "true") === "true") await upsertComment(md);
  const min = Number(input("fail-below", "0"));
  if (min > 0 && audit.score < min) fail(`Launch-readiness score ${audit.score} is below the required ${min}.`);
})().catch((e) => fail(e.message || String(e)));
