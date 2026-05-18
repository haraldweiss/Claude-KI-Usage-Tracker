// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Curated list of HF GGUF models for the catalog page.
// Kept as TS so it ships into dist/ on tsc build (json files don't).
// pros/cons are general statements; setup_note compares to qwen3-coder (the
// model currently running for the bewerbungstracker) — edit when your setup changes.

export interface CuratedModelMeta {
  repo: string;
  pros: string[];
  cons: string[];
  setup_note: string;
}

export interface CuratedSpec {
  sections: Array<{
    key: string;
    label: string;
    default_quant: string;
    models: CuratedModelMeta[];
  }>;
}

export const CURATED_MODELS: CuratedSpec = {
  sections: [
    {
      key: 'code',
      label: 'Code',
      default_quant: 'Q4_K_M',
      models: [
        {
          repo: 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF',
          pros: [
            'Code-spezialisiert, deutlich stärker als allgemeine Llama-Modelle',
            'Sehr aktive Weiterentwicklung, gute Multi-Language-Coverage',
          ],
          cons: [
            'Vorgängergeneration von qwen3-coder — bei den meisten Code-Tasks unterlegen',
            'Reasoning schwächer als die DeepSeek-R1-Distill-Variante',
          ],
          setup_note:
            'Älter als dein qwen3-coder, eher Downgrade. Nur interessant, falls qwen3 zu langsam läuft und du Geschwindigkeit gegen Qualität tauschen willst.',
        },
        {
          repo: 'bartowski/Qwen2.5-Coder-32B-Instruct-GGUF',
          pros: [
            'Bei komplexen Tasks (Refactoring, längeren Code-Reviews) auf GPT-4-Niveau',
            'Reicher Kontext für mehrstufige Aufgaben',
          ],
          cons: [
            '~20 GB RAM in Q4_K_M — auf 16 GB Mac mini eng bis unmachbar',
            'Deutlich langsamer pro Token (3-5× gegenüber 7B)',
          ],
          setup_note:
            'Massiver Qualitäts-Upgrade gegenüber qwen3-coder, aber RAM-intensiv. Praktisch nur sinnvoll, wenn der Macbook (nicht der Mini) den Call ausführt — sonst OOM.',
        },
        {
          repo: 'bartowski/DeepSeek-Coder-V2-Lite-Instruct-GGUF',
          pros: [
            '16B MoE-Architektur (nur ~2.4B active) — schnell trotz Größe',
            'Besonders stark bei C++/Rust/Go-Code',
          ],
          cons: [
            'Ältere Generation (Mitte 2024)',
            'Deutsche Sprachqualität in Kommentaren/Docs schwächer als bei Qwen',
          ],
          setup_note:
            'Andere Stärken als dein qwen3-coder — interessant wenn du regelmäßig Systems-Code (Rust/Go/C++) schreibst. Für Python/JS/PHP bleibt qwen3-coder besser.',
        },
      ],
    },
    {
      key: 'chat',
      label: 'Chat / General',
      default_quant: 'Q4_K_M',
      models: [
        {
          repo: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',
          pros: [
            'Industrie-Standard für General-Chat, breitester Trainings-Corpus',
            'Solide deutsche Sprachqualität',
          ],
          cons: [
            'Nicht code-spezialisiert — bei Code-Tasks deutlich unter qwen3-coder',
            'Knowledge-Cutoff Mitte 2024',
          ],
          setup_note:
            'Ergänzung zu qwen3-coder für reine Text-Tasks (z.B. WordPress-Content, Bewerbungs-Anschreiben). qwen3-coder ist da überqualifiziert und schreibt steifer.',
        },
        {
          repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
          pros: [
            'Klein und schnell (~2 GB RAM in Q4), brauchbar für Klassifikation/Tagging',
            'Latenz unter einer Sekunde auf Apple Silicon',
          ],
          cons: [
            'Deutlich schwächer als 7B/8B-Modelle bei komplexen Anfragen',
            'Verliert Kontext bei langen Antworten',
          ],
          setup_note:
            'Sehr schnelles Background-Modell. Z.B. als Fallback im Bewerbungstracker für Email-Vorklassifikation, bevor du qwen3-coder fürs eigentliche Matching nutzt.',
        },
        {
          repo: 'MaziyarPanahi/Mistral-7B-Instruct-v0.3-GGUF',
          pros: [
            'Robust und vorhersagbar, gute Function-Calling-Unterstützung',
            'EU-Provenance (Mistral AI)',
          ],
          cons: [
            'Älter (Mitte 2024) — von Llama 3.1 und Qwen 2.5 in Benchmarks überholt',
            'Code-Qualität schwächer als Qwen-Familie',
          ],
          setup_note:
            'Ehrliche Alternative zu Llama 3.1, wenn dir EU-Provenance wichtig ist. Für Code bleibt qwen3-coder besser.',
        },
      ],
    },
    {
      key: 'reasoning',
      label: 'Reasoning',
      default_quant: 'Q4_K_M',
      models: [
        {
          repo: 'bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF',
          pros: [
            'Chain-of-Thought-Reasoning sichtbar im <think>-Block',
            'Sehr stark bei Mathematik, Logik, mehrstufigen Problemen',
          ],
          cons: [
            '<think>-Block kann lang werden — höhere Latenz und Token-Verbrauch',
            'Für simple Anfragen Overkill',
          ],
          setup_note:
            'Ergänzung zu qwen3-coder für Tasks die echtes Reasoning brauchen — z.B. komplexere Match-Logik im Bewerbungstracker. Für Standard-Code-Generation weiter qwen3-coder.',
        },
        {
          repo: 'bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF',
          pros: [
            'Reasoning-Fähigkeiten plus bessere allgemeine Sprachqualität als die Qwen-Distill',
            'Ehrlichere "Ich weiß es nicht"-Antworten als die Qwen-Variante',
          ],
          cons: [
            'Etwas größer (8B vs 7B), entsprechend mehr RAM',
            'Ähnliche Latenz-Probleme mit langem <think>-Block',
            '⚠️ Pull via hf.co/ schlägt in manchen Ollama-Versionen mit "not compatible with llama.cpp" fehl — Workaround unten',
          ],
          setup_note:
            'Wenn du Reasoning UND vernünftige deutsche Sprachqualität willst, ist diese hier die bessere Wahl als die Qwen-Distill. Falls der hf.co-Pull fehlschlägt: nimm die offizielle Ollama-Library-Version mit "ollama run deepseek-r1:8b" — funktioniert garantiert.',
        },
      ],
    },
  ],
};
