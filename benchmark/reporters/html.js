import fs from 'fs';
import path from 'path';

function scoreColor(score) {
  if (score == null) return '#888';
  if (score >= 80) return '#16a34a';
  if (score >= 60) return '#ca8a04';
  return '#dc2626';
}

export function writeHtmlReport(allResults, machineName, mode, runId) {
  const dir = path.join(process.cwd(), 'benchmark', 'results');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = machineName.toLowerCase().replace(/\s+/g, '-');
  const filename = `${ts}-${slug}.html`;
  const filepath = path.join(dir, filename);

  const rows = allResults.map(({ model, categories }) => {
    const get = (cat) => categories.find((c) => c.category === cat);
    const coding = get('coding')?.score;
    const general = get('general')?.score;
    const project = get('project')?.score;
    const speed = get('speed')?.score;
    const scores = [coding, general, project].filter((s) => s != null);
    const overall = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const cell = (v, isSpeed = false) => {
      const display = v != null ? (isSpeed ? v.toFixed(1) : v) : '—';
      const color = isSpeed ? '#374151' : scoreColor(v);
      return `<td style="color:${color};font-weight:600">${display}</td>`;
    };
    return `<tr><td>${model}</td>${cell(coding)}${cell(general)}${cell(project)}${cell(overall)}${cell(speed, true)}</tr>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Ollama Benchmark — ${machineName}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#111}
  h1{font-size:1.5rem;margin-bottom:.25rem}
  .meta{color:#555;font-size:.9rem;margin-bottom:1.5rem}
  table{width:100%;border-collapse:collapse;font-size:.95rem}
  th{background:#f3f4f6;text-align:left;padding:.6rem .8rem;border-bottom:2px solid #e5e7eb}
  td{padding:.55rem .8rem;border-bottom:1px solid #e5e7eb}
  tr:hover td{background:#f9fafb}
</style>
</head>
<body>
<h1>Ollama Benchmark — ${machineName}</h1>
<p class="meta">Mode: <b>${mode}</b> &nbsp;|&nbsp; Run ID: ${runId} &nbsp;|&nbsp; ${new Date().toISOString()}</p>
<table>
<thead><tr><th>Model</th><th>Coding</th><th>General</th><th>Project</th><th>Overall</th><th>Speed (t/s)</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>`;

  fs.writeFileSync(filepath, html);
  console.log(`HTML  → benchmark/results/${filename}`);
  return filepath;
}
