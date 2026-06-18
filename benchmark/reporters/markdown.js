import fs from 'fs';
import path from 'path';

export function writeMarkdownReport(allResults, machineName, mode, runId) {
  const dir = path.join(process.cwd(), 'benchmark', 'results');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = machineName.toLowerCase().replace(/\s+/g, '-');
  const filename = `${ts}-${slug}.md`;
  const filepath = path.join(dir, filename);

  const lines = [
    `# Ollama Benchmark — ${machineName}`,
    ``,
    `**Mode:** ${mode} | **Run ID:** ${runId} | **Date:** ${new Date().toISOString()}`,
    ``,
    `| Model | Coding | General | Project | Overall | Speed (t/s) |`,
    `|---|---|---|---|---|---|`,
  ];

  for (const { model, categories } of allResults) {
    const get = (cat) => categories.find((c) => c.category === cat);
    const coding = get('coding')?.score ?? '—';
    const general = get('general')?.score ?? '—';
    const project = get('project')?.score ?? '—';
    const speed = get('speed')?.score?.toFixed(1) ?? '—';
    const scores = [get('coding')?.score, get('general')?.score, get('project')?.score].filter((s) => s != null);
    const overall = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : '—';
    lines.push(`| ${model} | ${coding} | ${general} | ${project} | ${overall} | ${speed} |`);
  }

  fs.writeFileSync(filepath, lines.join('\n'));
  console.log(`MD    → benchmark/results/${filename}`);
  return filepath;
}
