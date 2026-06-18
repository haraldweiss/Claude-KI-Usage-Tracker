const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function colorScore(score) {
  if (score === null || score === undefined) return '  —  ';
  const s = typeof score === 'number' ? score.toFixed(1) : String(score);
  if (score >= 80) return `${GREEN}${s}${RESET}`;
  if (score >= 60) return `${YELLOW}${s}${RESET}`;
  return `${RED}${s}${RESET}`;
}

export function printTerminalReport(allResults, machineName, mode) {
  console.log(`\n${BOLD}=== Ollama Benchmark — ${machineName} — ${mode} mode ===${RESET}\n`);
  console.log(`${'Model'.padEnd(35)} ${'Coding'.padStart(8)} ${'General'.padStart(8)} ${'Project'.padStart(8)} ${'Overall'.padStart(8)} ${'Speed(t/s)'.padStart(10)}`);
  console.log('─'.repeat(85));

  for (const { model, categories } of allResults) {
    const coding = categories.find((c) => c.category === 'coding');
    const general = categories.find((c) => c.category === 'general');
    const project = categories.find((c) => c.category === 'project');
    const speed = categories.find((c) => c.category === 'speed');
    const scores = [coding?.score, general?.score, project?.score].filter((s) => s != null);
    const overall = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    console.log(
      `${model.slice(0, 34).padEnd(35)} ` +
      `${colorScore(coding?.score).padStart(8 + 9)} ` +
      `${colorScore(general?.score).padStart(8 + 9)} ` +
      `${colorScore(project?.score).padStart(8 + 9)} ` +
      `${colorScore(overall).padStart(8 + 9)} ` +
      `${(speed?.score?.toFixed(1) ?? '—').padStart(10)}`
    );
  }
  console.log('');
}
