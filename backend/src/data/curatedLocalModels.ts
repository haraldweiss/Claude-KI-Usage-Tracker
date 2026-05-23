// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Statische Pros/Cons-Lookup für lokal installierte Ollama-Modelle.
// Fallback wenn nicht im Cache + nicht curated: catalogProsConsService LLM-Pfad.

export type LocalModelFamily = 'chat' | 'code' | 'embedding' | 'custom';

export interface CuratedLocalEntry {
  family: LocalModelFamily;
  pros: string[];
  cons: string[];
  setup_note?: string;
}

// Reihenfolge im Objekt = Fallback-Reihenfolge bei Prefix-Match.
// Längere Keys ZUERST eintragen, damit 'qwen2.5-coder' vor 'qwen' trifft.
export const CURATED_LOCAL_MODELS: Record<string, CuratedLocalEntry> = {
  'deepseek-r1': {
    family: 'chat',
    pros: [
      'Starkes Reasoning-Modell mit Chain-of-Thought',
      'Vergleichbar mit GPT-4 bei Mathe- und Logikaufgaben',
      'Komplett offline lauffähig, keine API-Kosten',
    ],
    cons: [
      'Antworten enthalten oft sichtbares "thinking"-Markup',
      '8B-Variante deutlich schwächer als 70B/671B',
      'Langsamer als nicht-Reasoning-Modelle bei Trivial-Tasks',
    ],
  },
  'qwen2.5-coder': {
    family: 'code',
    pros: [
      'Beste Open-Source-Coder-Familie 2025, viele Sprachen',
      '32B-Variante schlägt GPT-4o bei vielen Code-Benchmarks',
      'FIM (Fill-In-Middle) für IDE-Integration optimiert',
    ],
    cons: [
      '32B braucht ≥24 GB RAM/VRAM für sinnvolle Tokens/s',
      'Deutsche Kommentare/Docstrings teilweise unsauber',
      'Schwächer bei sehr neuen Frameworks (Knowledge-Cutoff)',
    ],
  },
  'qwen3-coder': {
    family: 'code',
    pros: [
      'Nachfolger von Qwen2.5-Coder mit besseren Tool-Calls',
      'Native Function-Calling-Unterstützung',
      'Sehr gut bei Multi-File-Refactoring und Diffs',
    ],
    cons: [
      'Größerer Speicherbedarf als Qwen2.5-Coder',
      'Tool-Format weicht teils von Claude/OpenAI ab',
      'Manchmal über-eifrig beim Aufrufen nicht-existenter Tools',
    ],
  },
  'mistral-nemo': {
    family: 'chat',
    pros: [
      '12B-Modell mit 128k Kontext-Fenster',
      'Sehr gutes Deutsch und Französisch',
      'Apache-2.0-Lizenz, kommerziell frei nutzbar',
    ],
    cons: [
      'Code-Generierung schwächer als spezialisierte Coder',
      'Halluziniert bei sehr langen Kontexten (>80k)',
      'Keine native Tool-Use-Optimierung',
    ],
  },
  'llama3.1': {
    family: 'chat',
    pros: [
      'Meta-Llama mit 128k Kontext, sehr breit getestet',
      'Sehr gute Allzweck-Qualität bei 8B Größe',
      'Hervorragende Tool-Calling-Unterstützung',
    ],
    cons: [
      'Custom-Lizenz, nicht 100% Open Source',
      'Deutsche Antworten oft hölzern oder mit Anglizismen',
      'Bei 8B Faktualität schwächer als bei 70B',
    ],
  },
  'llama3': {
    family: 'chat',
    pros: [
      'Vorgänger von Llama-3.1, ausgereift und stabil',
      'Sehr verbreitet — viele Forks und Tools verfügbar',
      'Schnell auf Consumer-Hardware bei 8B',
    ],
    cons: [
      'Nur 8k Kontext (vs. 128k bei Llama-3.1)',
      'Veraltet — 3.1 ist in fast jeder Hinsicht besser',
      'Schwächer bei strukturiertem Output (JSON)',
    ],
  },
  'nomic-embed-text': {
    family: 'embedding',
    pros: [
      'Schnelles 137M-Embedding-Modell für RAG',
      'Bessere Qualität als OpenAI text-embedding-ada-002',
      'Apache-2.0, klein genug für CPU-Inferenz',
    ],
    cons: [
      'Kein Chat — nur für Vektor-Embeddings nutzbar',
      'Nur englisch-optimiert, Deutsch schwächer',
      '768-Dim-Output zu groß für sehr große Datasets',
    ],
    setup_note: 'Nutzung: ollama embeddings nomic-embed-text "text…"',
  },
  'supergemma': {
    family: 'chat',
    pros: [
      'Gemma-Variante ohne Refusal-Training',
      'Sehr direkt bei Sicherheits- und Pen-Test-Themen',
      'Solide deutsche Sprachqualität',
    ],
    cons: [
      'Uncensored — Output muss vor Weiterleitung gefiltert werden',
      '26B braucht ≥16 GB RAM/VRAM',
      'Schwächer bei Code-Generierung als Qwen-Coder',
    ],
  },
  'gemma': {
    family: 'chat',
    pros: [
      'Googles offene Modell-Familie, hohe Faktualität',
      'Mehrsprachig stark, gut für RAG-Pipelines',
      'Kleine Varianten (2B) für Edge-Hardware',
    ],
    cons: [
      'Strikte Safety-Filter, viele Refusals',
      'Custom Gemma-Lizenz, nicht klassisches OSI-OS',
      'Schwächer bei mathematischem Reasoning',
    ],
  },
  'dev-coder': {
    family: 'code',
    pros: [
      'Custom-Build für lokale Dev-Workflows',
      'Auf eigene Codebase fine-getuned',
      'Schneller als generische Coder bei vertrauten Tasks',
    ],
    cons: [
      'Nicht öffentlich dokumentiert — nur lokal nutzbar',
      'Stagniert wenn nicht regelmäßig neu trainiert',
      'Keine externe Qualitäts-Benchmarks verfügbar',
    ],
  },
  'soc-analyst': {
    family: 'custom',
    pros: [
      'Spezialisiert auf Security-Operations-Analyse',
      'Versteht SIEM-Logs und Alert-Triage-Kontext',
      'Strukturierte Incident-Berichte als Output',
    ],
    cons: [
      'Custom-Build, keine externe Qualitätssicherung',
      'Nicht für allgemeine Chat-Aufgaben geeignet',
      'Trainingsdaten und Lizenz proprietär',
    ],
  },
  'soc-detect': {
    family: 'custom',
    pros: [
      'Auf Threat-Detection und IOC-Analyse trainiert',
      'Erkennt MITRE-ATT&CK-Patterns in Log-Snippets',
      'Komplett lokal — keine Daten verlassen das System',
    ],
    cons: [
      'Custom-Build ohne öffentliche Benchmarks',
      'False-Positives bei ungewöhnlichen Log-Formaten',
      'Wissen veraltet — neue CVEs nicht im Training',
    ],
  },
};

// Reihenfolge der Lookup-Keys: längster Match zuerst, damit
// 'qwen2.5-coder' nicht fälschlich auf 'qwen' verkürzt wird.
const SORTED_KEYS = Object.keys(CURATED_LOCAL_MODELS).sort(
  (a, b) => b.length - a.length,
);

// Wandelt einen Ollama-Modellnamen in den Lookup-Key der curated Map um.
// Schritte: hf.co-Prefix strippen, ":tag"-Suffix entfernen, "-cc"/"-gguf"/
// "-uncensored"-Suffixe entfernen, Versions-Suffixe wie "4-26b" trimmen,
// lowercase. Liefert den Basis-Familiennamen.
export function normalizeOllamaName(name: string): string {
  let s = name.trim().toLowerCase();

  // Strip hf.co/<owner>/ prefix
  s = s.replace(/^hf\.co\/[^/]+\//, '');
  // Strip <owner>/ prefix (e.g. anubclaw/dev-coder)
  if (s.includes('/')) {
    s = s.substring(s.indexOf('/') + 1);
  }
  // Strip :tag suffix
  s = s.replace(/:.*$/, '');
  // Strip common suffixes
  s = s
    .replace(/-gguf-v\d+$/, '')
    .replace(/-gguf$/, '')
    .replace(/-uncensored$/, '')
    .replace(/-instruct$/, '')
    .replace(/-cc$/, '');
  // Meta-llama-3.1-8b → llama3.1   (strip "meta-" prefix and "-Nb" size)
  s = s.replace(/^meta-/, '');
  s = s.replace(/-(\d+(\.\d+)?)b(-.*)?$/, '');
  // "llama-3.1" → "llama3.1"
  s = s.replace(/^llama-(\d)/, 'llama$1');
  // "supergemma4-26b" → matched above; remaining "supergemma4" → "supergemma"
  s = s.replace(/^supergemma\d+$/, 'supergemma');

  // Try exact match against sorted keys (longest first).
  // This handles partial prefixes like "qwen2.5-coder-32b" → "qwen2.5-coder".
  for (const key of SORTED_KEYS) {
    if (s === key || s.startsWith(key + '-') || s.startsWith(key + '.')) {
      return key;
    }
  }
  return s;
}

export function lookupCuratedLocal(name: string): CuratedLocalEntry | null {
  const key = normalizeOllamaName(name);
  return CURATED_LOCAL_MODELS[key] ?? null;
}
