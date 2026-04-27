# Claude Usage Tracker

Eine umfassende Webanwendung zur Überwachung und Analyse der Claude AI-Token-Nutzung, Kosten und intelligenten Modellempfehlungen für optimale API-Nutzung.

**Status**: ✅ Produktionsreif (Phase 3 abgeschlossen - Vollständige TypeScript-Migration)

---

## 🎯 Features

### Kernfunktionalität
- **Echtzeit-Nutzungsverfolgung**: Browser-Erweiterung interceptiert Claude.ai API-Aufrufe und protokolliert Token-Nutzung automatisch
- **Selbstpflegende Preise**: Mitgelieferter Snapshot deckt Claude 4.x (Opus 4.7, Sonnet 4.6, Haiku 4.5), die 3.7-Reihe und ältere Modelle ab. Tägliche LiteLLM-Synchronisation hält Preise aktuell, sobald Anthropic neue Modelle veröffentlicht.
- **Auto-Erkennung neuer Modelle**: Meldet die Erweiterung ein bisher unbekanntes Modell, legt das Backend automatisch eine Preiszeile mit dem Tarif eines Schwester-Modells (Haiku/Sonnet/Opus) an — oder markiert sie als *Needs review*, falls keine Familie erkennbar ist. Manuelle Preise in den Einstellungen werden nie automatisch überschrieben.
- **Kostenanalyse**: Automatische Kostenberechnung; bei Bestätigung eines vorläufigen Preises werden zurückliegende Datensätze rückwirkend neu berechnet.
- **Intelligente Modellempfehlungen**: DB-getriebene Engine — neue Modelle erscheinen ohne Code-Änderungen automatisch in den Empfehlungen.
- **Optimierungseinblicke**: Identifiziert Möglichkeiten, Kosten zu senken und Effizienz zu verbessern
- **Schönes Dashboard**: React-basierte UI mit Diagrammen, Tabellen, Quelle/Status-Badges und Echtzeit-Statistiken

### Smart Recommendation Engine
- **Task-Komplexitätsanalyse**: Bewertet Task-Beschreibungen zur Bestimmung der erforderlichen Modell-Kapabilität
- **Sicherheits-Score-Berechnung**: Analysiert historische Erfolgsquoten für jedes Modell
- **Kosten-Nutzen-Optimierung**: Balanciert Sicherheitsanforderungen mit Kosteneffizienz
- **Gelegenheitserkennung**: Identifiziert, wo Sie teure Modelle nutzten, obwohl günstigere ausreichten
- **Modell-Analytik**: Tägliche Aggregation von Nutzungsmustern, Erfolgsquoten und Kosten-pro-Request

### Architektur
- **Backend**: Node.js + Express.js + TypeScript
- **Frontend**: React + TypeScript + Vite
- **Datenbank**: SQLite mit typisierten Abfragen
- **Erweiterung**: Chrome-Erweiterung für automatische API-Interception
- **Typsicherheit**: 100% TypeScript mit strict mode aktiviert

---

## 📋 Voraussetzungen

- **Node.js**: 16+ (mit npm oder yarn)
- **Chrome/Chromium**: Für die Browser-Erweiterung
- **SQLite**: Enthalten im Node.js-Ökosystem (keine externe Installation nötig)

---

## 🚀 Schnellstart

### 1. Repository klonen
```bash
git clone git@github.com:haraldweiss/Claude-KI-Usage-Tracker.git
cd Claude-KI-Usage-Tracker
```

### 2. Abhängigkeiten installieren

**Backend:**
```bash
cd backend
npm install
npm run type-check  # TypeScript-Kompilierung überprüfen
```

**Frontend:**
```bash
cd ../frontend
npm install
npm run type-check  # TypeScript-Kompilierung überprüfen
```

### 3. Anwendung ausführen

**Terminal 1 - Backend (Port 3000):**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend (Port 5173):**
```bash
cd frontend
npm run dev
```

**Terminal 3 - Erweiterung installieren (Chrome):**
1. Öffne `chrome://extensions`
2. Aktiviere "Entwicklermodus" (oben rechts)
3. Klicke "Entpackte Erweiterung laden"
4. Wähle das `/extension` Verzeichnis
5. Erweiterung sollte als aktiv angezeigt werden

### 4. Beginne zu nutzen

1. Besuche `http://localhost:5173` in deinem Browser
2. Nutze Claude.ai normal in einem anderen Tab
3. API-Aufrufe werden automatisch protokolliert und erscheinen im Dashboard
4. Echtzeitstatistiken, Kosten und Empfehlungen anzeigen

---

## 📚 Dokumentation

### Kernanleitungen
- **[Installationsanleitung](./INSTALLATION.md)** - Detaillierte Anleitung für jede Komponente
- **[Schnellstart](./QUICKSTART.md)** - In 5 Minuten aktivieren
- **[Benutzerhandbuch](./USER_GUIDE_DE.md)** - Vollständige Feature-Dokumentation
- **[Architektur-Anleitung](./ARCHITECTURE.md)** - Systemdesign und Komponentenübersicht

### Technische Referenz
- **[API-Dokumentation](./docs/API.md)** - TypeScript Endpoint-Signaturen und Payloads
- **[TypeScript-Migration](./PHASE3_STATUS.md)** - Phase 3 Abschlussdetails
- **[Test-Zusammenfassung](./TESTING.md)** - Test-Abdeckung und Strategien
- **[Umgebungseinrichtung](./ENV_SETUP.md)** - Konfiguration und Umgebungsvariablen

### Projektstatus
- **[Phase 3 Status](./PHASE3_STATUS.md)** - Vollständige Migration zu TypeScript (alle 7 Tasks ✅)
- **[Projekt-Zusammenfassung](./PROJECT_SUMMARY.txt)** - Hohe Übersicht
- **[Sicherheitshinweise](./SECURITY.md)** - Sicherheitsüberlegungen und Best Practices

---

## 🏗️ Projektstruktur

```
Claude-KI-Usage-Tracker/
├── backend/
│   ├── src/
│   │   ├── server.ts           # Express-App mit Middleware & Cron-Jobs
│   │   ├── controllers/        # Request-Handler (usage, pricing, recommendations)
│   │   ├── routes/             # API-Routen mit Validatoren
│   │   ├── services/           # Geschäftslogik (pricing, model recommendations)
│   │   ├── middleware/         # Fehlerbehandlung, Validierungs-Middleware
│   │   ├── database/           # SQLite-Einrichtung und typisierte Abfragefunktionen
│   │   ├── types/              # TypeScript-Typedefinitionen (70+ Interfaces)
│   │   └── utils/              # Hilfsfunktionen
│   ├── dist/                   # Kompiliertes JavaScript (durch `npm run build` erstellt)
│   ├── tsconfig.json           # TypeScript-Konfiguration (strict: true)
│   └── jest.config.js          # Test-Konfiguration
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Hauptanwendungskomponente
│   │   ├── pages/              # Seiten-Komponenten (Dashboard, Settings, Recommendations)
│   │   ├── components/         # Wiederverwendbare UI-Komponenten
│   │   ├── services/           # API-Client und Utility-Funktionen
│   │   ├── types/              # TypeScript-Interfaces für Komponenten & API
│   │   └── index.tsx           # Entry Point
│   ├── dist/                   # Erstellte Assets (durch `npm run build` erstellt)
│   ├── vite.config.ts          # Vite-Konfiguration
│   ├── tsconfig.json           # TypeScript-Konfiguration mit Path-Aliases
│   └── vitest.config.js        # Vitest-Konfiguration
│
├── extension/
│   ├── manifest.json           # Chrome-Erweiterungs-Konfiguration (MV3)
│   ├── background.js           # Service Worker (API-Call-Interception)
│   ├── content.js              # Content Script (Fetch-Interception)
│   ├── popup.html/js           # Popup-UI mit Echtzeit-Statistiken
│   └── icons/                  # Erweiterungs-Symbole
│
├── docs/
│   ├── plans/                  # Implementierungspläne
│   └── API.md                  # API-Endpoint-Dokumentation
│
└── database.sqlite             # SQLite-Datenbank (wird beim ersten Start erstellt)
```

---

## 🔌 API-Endpoints

### Nutzungsverfolgung
- `POST /api/usage/track` - Token-Nutzungsereignis protokollieren
- `GET /api/usage/summary?period=day|week|month` - Aggregierte Nutzungsstatistiken
- `GET /api/usage/models` - Aufschlüsselung nach Modell
- `GET /api/usage/history?limit=50&offset=0` - Letzte Nutzungsdatensätze

### Preisgestaltungsverwaltung
- `GET /api/pricing` - Alle Modellpreise abrufen (enthält `source`, `status`, `tier`, `api_id`, `last_updated`)
- `PUT /api/pricing/:model` - Preisgestaltung für Modell aktualisieren (setzt `source='manual'`)
- `POST /api/pricing/:model/confirm` - Auto-erkannten `pending_confirmation`-Eintrag bestätigen; Body `{inputPrice?, outputPrice?}` (weggelassene Felder behalten ihre bestehenden Werte). Setzt den Eintrag auf `source='manual'`, `status='active'` und berechnet die Kosten der jüngsten usage_records neu.

### Modellempfehlungen
- `POST /api/recommend` - Modellempfehlung für Task-Beschreibung
- `GET /api/recommend/analysis/models?period=day|week|month` - Modell-Statistiken & Erfolgsquoten
- `GET /api/recommend/analysis/opportunities?period=day|week|month` - Kostenoptimierungs-Möglichkeiten

Siehe [API-Dokumentation](./docs/API.md) für vollständige Request/Response-Schemas mit TypeScript-Typen.

---

## 🧪 Tests

Das Projekt enthält umfassende Test-Abdeckung:

**Backend-Tests** (Jest):
```bash
cd backend
npm test                    # Alle Tests ausführen
npm run test:watch         # Watch-Modus
npm run test:coverage      # Coverage-Bericht generieren
```

**Frontend-Tests** (Vitest):
```bash
cd frontend
npm test                    # Alle Tests ausführen
npm run test:watch         # Watch-Modus
npm run test:coverage      # Coverage-Bericht generieren
```

**Aktueller Status**: 90/90 Tests erfolgreich (57 Backend — 52 Unit + 5 HTTP-Integration via supertest — und 33 Frontend) ✅

Das Backend nutzt im Dev-Modus `tsx` (kein separater Build-Schritt nötig). Für Produktion: `npm run build && npm start` baut nach `dist/` und führt das kompilierte Output aus.

---

## 🔧 Entwicklung

### Für Produktion erstellen

**Backend:**
```bash
cd backend
npm run build              # Erstellt dist/ Ordner mit kompiliertem TypeScript
npm run type-check        # TypeScript-Sicherheit überprüfen
```

**Frontend:**
```bash
cd frontend
npm run build             # Erstellt optimiertes Bundle in dist/
npm run type-check        # TypeScript-Sicherheit überprüfen
```

### Code-Qualität

Backend und Frontend nutzen beide ESLint und Prettier:
```bash
# Backend
cd backend
npm run lint              # Auf Linting-Probleme überprüfen
npm run lint:fix          # Probleme automatisch beheben
npm run format            # Prettier ausführen

# Frontend
cd frontend
npm run lint
npm run lint:fix
npm run format
```

---

## 🌍 Konfiguration

### Umgebungsvariablen

Erstelle `.env`-Dateien in `backend/` und `frontend/` Verzeichnissen:

**Backend (.env)**:
```env
PORT=3000
DATABASE_PATH=./database.sqlite
NODE_ENV=development
ANTHROPIC_API_KEY=your_key_here  # Für Preisgestaltungs-Updates
```

**Frontend (.env)**:
```env
VITE_API_URL=http://localhost:3000
```

Siehe `.env.example`-Dateien in jedem Verzeichnis für alle verfügbaren Optionen.

---

## 🐛 Fehlerbehebung

| Problem | Lösung |
|---------|--------|
| Port 3000 bereits in Benutzung | `PORT=3001 npm run dev` im Backend |
| Erweiterung verfolgt keine Daten | Erweiterung neuladen (chrome://extensions), Backend läuft |
| "Keine Daten" im Dashboard | Claude.ai zuerst nutzen, 5s warten, Dashboard aktualisieren |
| TypeScript-Fehler | `npm run type-check` ausführen, dann `npm run lint:fix` |
| Tests schlagen fehl | node_modules löschen, `npm install`, dann `npm test` |
| Datenbank gesperrt | Alle Verbindungen schließen und Backend neu starten |

---

## 📊 Schlüsselstatistiken

- **TypeScript-Abdeckung**: 100% (65+ .ts/.tsx Dateien, 3.000+ Zeilen)
- **Typedefinitionen**: 70+ Interfaces/Typen über API, Models und Services
- **Test-Abdeckung**: 90/90 Tests erfolgreich (57 Backend Jest, 33 Frontend Vitest)
- **Komponenten**: 14 vollständig typisierte React-Komponenten
- **API-Endpoints**: 10+ Endpoints mit vollständigen TypeScript-Signaturen

---

## 🔐 Sicherheit

- **Keine sensiblen Daten** werden an externe Services gesendet (außer Anthropic)
- **Preisgestaltungs-API-Aufrufe** werden nur serverseitig durchgeführt (Backend)
- **Datenbank** ist lokales SQLite (nicht Cloud-basiert)
- **Erweiterung** kommuniziert nur mit localhost-Backend
- **Typsicherheit** verhindert viele häufige Sicherheitslücken

Siehe [Sicherheitshinweise](./SECURITY.md) für detaillierte Sicherheitsüberlegungen.

---

## 🚀 Leistung

- **Echtzeitaktualisierungen**: Dashboard aktualisiert sich alle 10 Sekunden
- **Optimierte Abfragen**: Indexierte Datenbankabfragen für schnelle Lookups
- **Frontend-Bundle**: ~150 KB gzippt (Vite optimiert)
- **Backend**: Sub-Millisekunden-Abfrageantworten

---

## 🤝 Beiträge

Dies ist ein persönliches Projekt, aber Sie können gerne forken und anpassen:

1. Erstellen Sie einen Branch: `git checkout -b feature/your-feature`
2. Vornehmen Sie Änderungen und testen Sie: `npm test`
3. Committen Sie mit TypeScript-Validierung: `npm run type-check && git commit -m "feat: description"`
4. Pushen Sie: `git push origin feature/your-feature`

---

## 📝 Lizenz

MIT-Lizenz - Siehe [LICENSE](./LICENSE) für Details.

---

## 🎓 Lernressourcen

Dieses Projekt demonstriert:
- **TypeScript** mit strict mode und Generika
- **React** Funktionskomponenten mit Hooks und Error Boundaries
- **Express.js** mit Middleware und Routing
- **Jest & Vitest** für Unit-Testing
- **Vite** für schnelle Builds
- **Chrome-Erweiterung** Entwicklung mit MV3
- **SQLite** mit typsicheren Abfragen
- **Clean Architecture** mit Separation of Concerns

---

## 📬 Unterstützung

Bei Problemen oder Fragen:
1. Überprüfen Sie den [Fehlerbehebungsbereich](#-fehlerbehebung) oben
2. Lesen Sie relevante Dokumentation in `/docs` oder `/backend/docs`
3. Überprüfen Sie GitHub-Issues, falls öffentlich

---

**Zuletzt aktualisiert**: April 2026 (Phase 3 abgeschlossen)  
**Verwaltet von**: Harald Weiss  
**Repository**: [GitHub](https://github.com/haraldweiss/Claude-KI-Usage-Tracker)
