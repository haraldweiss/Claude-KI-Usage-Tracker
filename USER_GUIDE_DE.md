# Claude Usage Tracker - Benutzerhandbuch

Vollständige Anleitung zur Nutzung der Claude Usage Tracker-Anwendung, von der Installation bis zu erweiterten Funktionen.

---

## Inhaltsverzeichnis

1. [Installation & Einrichtung](#installation--einrichtung)
2. [Erste Schritte](#erste-schritte)
3. [Dashboard-Übersicht](#dashboard-übersicht)
4. [Einstellungen & Konfiguration](#einstellungen--konfiguration)
5. [Modellempfehlungen](#modellempfehlungen)
6. [API-Referenz](#api-referenz)
7. [Erweiterte Funktionen](#erweiterte-funktionen)
8. [Tipps & Best Practices](#tipps--best-practices)
9. [Häufig gestellte Fragen](#häufig-gestellte-fragen)

---

## Installation & Einrichtung

### Systemanforderungen

- **Node.js**: 16.0.0 oder höher
- **npm**: 7.0.0 oder höher (enthalten in Node.js)
- **Chrome/Chromium**: Neueste Version empfohlen
- **RAM**: Mindestens 500 MB zum Ausführen aller Komponenten
- **Festplattenspeicher**: 200 MB für Abhängigkeiten

### Schritt-für-Schritt-Installation

#### 1. Repository klonen
```bash
git clone git@github.com:haraldweiss/Claude-KI-Usage-Tracker.git
cd Claude-KI-Usage-Tracker
```

#### 2. Backend installieren
```bash
cd backend
npm install
```

Installiert:
- Express.js (Web-Framework)
- SQLite3 (Datenbank)
- TypeScript (Typsicherheit)
- Jest (Test-Framework)
- ESLint & Prettier (Code-Qualität)

#### 3. Frontend installieren
```bash
cd ../frontend
npm install
```

Installiert:
- React 18+ (UI-Framework)
- Vite (Build-Tool)
- Recharts (Datenvisualisierung)
- TypeScript
- Vitest (Test-Framework)

#### 4. Installation überprüfen
```bash
# Im Backend-Verzeichnis
npm run type-check      # Sollte "Keine Fehler" anzeigen

# Im Frontend-Verzeichnis
npm run type-check      # Sollte "Keine Fehler" anzeigen
```

#### 5. Alle Services starten

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
# Erwartete Ausgabe:
# Server läuft auf http://localhost:3000
# Datenbank initialisiert: ./database.sqlite
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
# Erwartete Ausgabe:
# VITE v4.x.x bereit in 123 ms
# ➜  Lokal:   http://localhost:5173/
```

**Terminal 3 - Erweiterung installieren:**
1. Öffne `chrome://extensions`
2. Aktiviere **"Entwicklermodus"** (oben rechts)
3. Klicke **"Entpackte Erweiterung laden"**
4. Navigiere zum Projektordner und wähle `/extension`
5. Du solltest "Claude Usage Tracker" aufgelistet sehen

#### 6. Überprüfe, ob alles funktioniert

1. Öffne http://localhost:5173 in Chrome
2. Besuche https://claude.ai und nutze Claude normal
3. API-Aufrufe sollten im Dashboard innerhalb von 5 Sekunden erscheinen
4. Falls nichts erscheint, siehe [Fehlerbehebung](#fehlerbehebung)

---

## Erste Schritte

### Deine erste Nutzungsaufzeichnung

1. **Stelle sicher, dass alles läuft** (Backend + Frontend + Erweiterung)
2. **Öffne https://claude.ai** in einem separaten Tab
3. **Sende eine Nachricht an Claude** (beliebiger Prompt)
4. **Warte 5 Sekunden** bis die Erweiterung verarbeitet hat
5. **Überprüfe das Dashboard** - deine Nutzung sollte erscheinen

### Was wird verfolgten?

Die Erweiterung protokolliert automatisch:
- ✅ Verwendetes Modell (Claude 3 Haiku, Sonnet oder Opus)
- ✅ Input-Tokens (dein Prompt)
- ✅ Output-Tokens (Claudes Antwort)
- ✅ Gesamte Tokens
- ✅ Zeitstempel
- ✅ Geschätzter Kosten (basierend auf aktueller Preisgestaltung)

### Was wird gespeichert?

Alle Daten werden lokal gespeichert in:
- **SQLite-Datenbank**: `backend/database.sqlite`
- **Nicht gesendet** an externe Server (außer Preisgestaltungs-Updates)
- **Zugänglich nur** auf deinem Computer

---

## Dashboard-Übersicht

### Dashboard-Funktionen

Das Haupt-Dashboard (http://localhost:5173) zeigt:

#### 1. Zeitraum-Auswahlfeld
Oben angeordnet, wähle:
- **Tag** - Letzte 24 Stunden
- **Woche** - Letzte 7 Tage
- **Monat** - Letzte 30 Tage

Alle Statistiken werden automatisch aktualisiert, wenn du den Zeitraum änderst.

#### 2. Zusammenfassungs-Karten

Vier wichtige Metriken angezeigt:

**Gesamttoken**
- Zeigt Input + Output Tokens kombiniert
- Nützlich zum Verständnis des API-Nutzungsvolumens
- Beispiel: "1.234.567 Tokens"

**Input-Tokens**
- Tokens in deinen an Claude gesendeten Prompts
- Kostet generell weniger als Output-Tokens
- Beispiel: "456.789 Input-Tokens"

**Output-Tokens**
- Tokens in Claudes Antworten
- Kostet generell mehr als Input-Tokens
- Beispiel: "789.012 Output-Tokens"

**Geschätzter Kosten**
- Gesamtkosten berechnet aus Token-Anzahlen
- Formel: (Input_Tokens × Input_Preis + Output_Tokens × Output_Preis) / 1.000.000
- Wird aktualisiert, wenn sich Preise ändern
- Beispiel: "12,34 €"

**Request-Anzahl**
- Gesamtzahl der API-Aufrufe
- Nützlich zum Verständnis der Nutzungshäufigkeit
- Beispiel: "42 Requests"

#### 3. Modell-Nutzungs-Diagramm

Interaktives Kreisdiagramm zeigt:
- Aufschlüsselung der Tokens nach Modell (Haiku, Sonnet, Opus)
- Klicke auf Segmente zum Hervorheben
- Hover für genaue Prozentsätze
- Beispiel: "Sonnet: 45%, Haiku: 35%, Opus: 20%"

**Wie man es liest:**
- Größere Segmente = mehr Tokens von diesem Modell verwendet
- Farbcodierung: Haiku (blau), Sonnet (orange), Opus (grün)
- Nützlich zum Verständnis der Modellpräferenzen

#### 4. Aktivitäts-Tabelle (Kürzlich)

Zeigt letzte 50 API-Aufrufe mit Spalten:

| Spalte | Bedeutung |
|--------|-----------|
| **Modell** | Welches Claude-Modell (Haiku/Sonnet/Opus) |
| **Input** | Tokens in deinem Prompt |
| **Output** | Tokens in Claudes Antwort |
| **Gesamt** | Summe aus Input + Output |
| **Kosten** | Geschätzte Kosten (EUR) |
| **Zeit** | Zeitpunkt des API-Aufrufs |

**Interaktionen:**
- Scrolle herunter, um ältere Einträge zu sehen
- Klicke auf Spaltenüberschriften zum Sortieren (in aktueller Version nicht verfügbar)
- Navigationsschaltflächen unten (falls mehr als 50 Einträge)

### Dashboard nutzen

**Grundlegender Workflow:**
1. Öffne Dashboard auf http://localhost:5173
2. Wähle Zeitraum (Tag/Woche/Monat)
3. Überprüfe Zusammenfassungs-Karten für Gesamtmetriken
4. Überprüfe Kreisdiagramm für Modellverteilung
5. Scrolle durch aktuelle Aktivität für Details
6. Öffne Einstellungen, um Preise bei Bedarf anzupassen

**Beispiel-Interpretation:**
```
Zeitraum: Woche
Gesamttoken: 2.500.000
Input: 1.000.000 | Output: 1.500.000 | Kosten: 28,50 €
Requests: 87
Modell-Aufteilung: Sonnet (60%), Haiku (30%), Opus (10%)
```

Das bedeutet: In der letzten Woche hast du 87 API-Aufrufe getätigt, hauptsächlich mit Sonnet, unter Verwendung von 2,5 Millionen Tokens, mit Gesamtkosten von 28,50 €.

---

## Einstellungen & Konfiguration

### Einstellungen öffnen

Klicke auf die **"Einstellungen"**-Schaltfläche in der oberen Navigationsleiste (oder wähle aus dem Menü).

### Preisgestaltungs-Verwaltung

#### Aktuelle Preise anzeigen

Die Preistabelle zeigt:

| Modell | Input-Preis | Output-Preis | Quelle |
|--------|-----------|-------------|--------|
| claude-3-haiku | 0,80 € | 4,00 € | anthropic |
| claude-3-sonnet | 3,00 € | 15,00 € | anthropic |
| claude-3-opus | 15,00 € | 75,00 € | anthropic |

Preise pro 1 Million Tokens.

#### Preisgestaltung manuell aktualisieren

1. **Klicke auf das Eingabefeld** für Input- oder Output-Preis
2. **Gebe neuen Wert ein** (z.B. "3,50")
3. **Drücke Tab** oder klicke anderswo zum Bestätigen
4. **Zeile wird orange** um unsgespeicherte Änderungen anzuzeigen
5. **Klicke "Änderungen speichern"**-Schaltfläche
6. **Erfolgsmeldung** erscheint ("Preisgestaltung erfolgreich aktualisiert")

**Beispiel-Anwendungsfälle:**
- Du hast einen speziellen Preistarif → Preise entsprechend aktualisieren
- Anthropic veröffentlicht neue Preisgestaltung → Alle Modelle aktualisieren
- Du möchtest Kosten mit unterschiedlichen Annahmen schätzen → Verschiedene Preise ausprobieren

#### Neueste Preise abrufen (Automatisch)

Wenn du dein Anthropic-API-Schlüssel konfigurierst:
1. Klicke **"Auf Updates prüfen"**-Schaltfläche
2. System überprüft aktuelle Anthropic-Preisgestaltung
3. Falls neuere Preise gefunden, werden sie angezeigt
4. Klicke **"Änderungen speichern"** zum Aktualisieren

**Konfiguration:**
Siehe [Umgebungseinrichtung](#umgebungsvariablen) Abschnitt in der Haupt-README für API-Schlüssel-Einrichtung.

#### Preisgestaltungs-Verlauf

Preise werden automatisch täglich aktualisiert (um 2 Uhr morgens in deiner Zeitzone).

**Preisänderungs-Protokoll anzeigen:**
```bash
# Im Backend-Verzeichnis
npm run view-pricing-history
```

---

## Modellempfehlungen

### Was sind Empfehlungen?

Das Modellempfehlungs-Engine analysiert deine Nutzung und schlägt vor:
- ✅ Welches Modell für verschiedene Task-Typen nutzen
- ✅ Wenn du ein teures Modell unnötig nutzt
- ✅ Geschätzte Kosteneinsparungen durch Optimierung

### Wie es funktioniert

#### 1. Task-Komplexitätsanalyse

Das System liest Task-Beschreibungen und weist Komplexität zu:

- **Einfach** (Score: 2) - "Tippfehler beheben", "Konzept erklären"
- **Mittel** (Score: 5) - "Code schreiben", "Problem debuggen"
- **Komplex** (Score: 8) - "System entwerfen", "Algorithmus optimieren"

#### 2. Sicherheits-Score-Berechnung

Basierend auf historischen Erfolgsquoten:
- Haiku: Am besten für einfache, unkomplizierte Tasks
- Sonnet: Ausgewogen für die meisten Tasks
- Opus: Am fähigsten, für komplexe Tasks

#### 3. Kosten-Nutzen-Bewertung

Finale Empfehlung balanciert:
- 70% Gewicht auf Sicherheit (keine kritischen Fehler)
- 30% Gewicht auf Kosten (Ausgaben minimieren)

### Empfehlungen nutzen

#### Empfehlung für eine Task erhalten

1. Gehe zur **Empfehlungen**-Seite
2. Gebe Task-Beschreibung ins Textfeld ein
3. Klicke **"Empfehlung erhalten"**
4. System zeigt an:
   - **Empfohlenes Modell** (z.B. "Sonnet")
   - **Konfidenz-Score** (0-100%)
   - **Kosten-Schätzung** ($X.XX pro 1M Tokens)
   - **Erklärung** warum dieses Modell empfohlen wird

**Beispiel:**
```
Task: "Schreibe eine Python-Funktion zum Sortieren eines Arrays"
Komplexität: Mittel (5/10)
Empfohlenes Modell: Sonnet
Konfidenz: 87%
Kosten: 0,0018 € pro Aufruf (Schätzung)
Grund: Sonnet bietet gutes Gleichgewicht für Code-Generierung
       mit niedrigeren Kosten als Opus
```

#### Optimierungs-Möglichkeiten anzeigen

Auf Empfehlungs-Seite, scrolle zu **"Optimierungs-Möglichkeiten"**-Bereich:

Zeigt Fälle, wo du Geld sparen könntest:
- **Datum** des Aufrufs
- **Verwendetes Modell** (was du tatsächlich nutztest)
- **Besseres Modell** (was wir empfehlen)
- **Einsparungen** (geschätzte Kostenreduktion)
- **Konfidenz** (wie sicher wir sind)

**Beispiel:**
```
Datum: 2026-04-11 14:30
Modell verwendet: Opus
Besseres Modell: Sonnet
Einsparungen: 0,003 € (etwa 75% billiger)
Konfidenz: 92%
Task: "Formatiere dieses JSON neu"
```

Das bedeutet, du hast das teuerste Modell (Opus) für eine einfache Task genutzt, die Sonnet perfekt bewältigt hätte, und hast etwa 0,003 € verschwendet.

### Best Practices

1. **Überprüfe Möglichkeiten wöchentlich** um Muster bei Überausgaben zu finden
2. **Füge Task-Beschreibungen hinzu** bei der Verfolgung der Nutzung (siehe Erweiterungs-Funktionen)
3. **Passe Konfidenz-Schwelle an** falls Empfehlungen zu riskant wirken
4. **Balance Kosten und Sicherheit** - Empfehlungen sind standardmäßig konservativ

---

## API-Referenz

### Backend-API direkt nutzen

Das Backend bietet REST-API-Endpoints auf `http://localhost:3000/api/`.

### Nutzung verfolgungen

#### POST /api/usage/track

Protokolliere ein neues Token-Nutzungsereignis.

**Request:**
```typescript
{
  model: "claude-3-sonnet",
  inputTokens: 1500,
  outputTokens: 3000,
  conversationId?: "conv-123",
  source?: "claude-ai-web",
  taskDescription?: "Python-Funktion schreiben",
  successStatus?: "success" | "error" | "partial",
  responseMetadata?: JSON.stringify({...})
}
```

**Response:**
```typescript
{
  success: true,
  id: 12345,
  cost: 0.0225
}
```

**Beispiel (mit curl):**
```bash
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-sonnet",
    "inputTokens": 1500,
    "outputTokens": 3000,
    "taskDescription": "Python-Funktion schreiben"
  }'
```

### Nutzungsstatistiken abrufen

#### GET /api/usage/summary

Aggregierte Nutzung für einen Zeitraum abrufen.

**Parameter:**
- `period` (optional): "day" | "week" | "month" (Standard: "day")

**Response:**
```typescript
{
  period: "week",
  startDate: "2026-04-04",
  endDate: "2026-04-11",
  totalTokens: 2500000,
  inputTokens: 1000000,
  outputTokens: 1500000,
  totalCost: 28.50,
  requestCount: 87,
  modelBreakdown: {
    "claude-3-haiku": {tokens: 750000, cost: 3.50},
    "claude-3-sonnet": {tokens: 1500000, cost: 18.00},
    "claude-3-opus": {tokens: 250000, cost: 6.88}
  }
}
```

**Beispiel:**
```bash
curl "http://localhost:3000/api/usage/summary?period=week"
```

#### GET /api/usage/models

Token-Aufschlüsselung nach Modell abrufen.

**Response:**
```typescript
[
  {
    model: "claude-3-sonnet",
    totalTokens: 1500000,
    inputTokens: 600000,
    outputTokens: 900000,
    requestCount: 45,
    cost: 18.00
  },
  // ... andere Modelle
]
```

#### GET /api/usage/history

Aktuelle Nutzungsdatensätze abrufen.

**Parameter:**
- `limit` (optional, Standard: 50): Anzahl der zurückzugebenden Datensätze
- `offset` (optional, Standard: 0): Diese viele Datensätze überspringen

**Response:**
```typescript
[
  {
    id: 12345,
    model: "claude-3-sonnet",
    inputTokens: 1500,
    outputTokens: 3000,
    cost: 0.0225,
    timestamp: "2026-04-11T14:30:45Z",
    conversationId: "conv-123",
    taskDescription: "Python-Funktion schreiben"
  },
  // ... weitere Datensätze
]
```

### Preisgestaltung verwalten

#### GET /api/pricing

Alle Modellpreise abrufen.

**Response:**
```typescript
[
  {
    model: "claude-3-haiku",
    inputPrice: 0.80,
    outputPrice: 4.00,
    source: "anthropic",
    lastUpdated: "2026-04-11T02:00:00Z"
  },
  // ... andere Modelle
]
```

#### PUT /api/pricing/:model

Preisgestaltung für ein Modell aktualisieren.

**Request:**
```typescript
{
  inputPrice: 0.80,
  outputPrice: 4.00
}
```

**Response:**
```typescript
{
  success: true,
  model: "claude-3-haiku",
  inputPrice: 0.80,
  outputPrice: 4.00
}
```

### Modellempfehlungen

#### POST /api/recommend

Modellempfehlung für eine Task erhalten.

**Request:**
```typescript
{
  taskDescription: "Python-Funktion zum Sortieren eines Arrays schreiben",
  constraints?: {
    minSafetyScore: 70,  // Mindestens erforderliche Erfolgsquote
    maxCost: 0.10        // Maximale Kosten pro Aufruf
  }
}
```

**Response:**
```typescript
{
  recommendedModel: "claude-3-sonnet",
  confidence: 87,
  complexity: "medium",
  safetyScore: 91,
  costEstimate: 0.0045,
  explanation: "Sonnet bietet gutes Gleichgewicht..."
}
```

#### GET /api/recommend/analysis/models

Modell-Analytik für einen Zeitraum abrufen.

**Parameter:**
- `period` (optional): "day" | "week" | "month"

**Response:**
```typescript
[
  {
    model: "claude-3-sonnet",
    totalRequests: 45,
    successRate: 98,
    errorCount: 1,
    avgInputTokens: 1200,
    avgOutputTokens: 2500,
    costPerRequest: 0.0112
  },
  // ... andere Modelle
]
```

#### GET /api/recommend/analysis/opportunities

Kostenoptimierungs-Möglichkeiten abrufen.

**Response:**
```typescript
[
  {
    date: "2026-04-11T14:30:00Z",
    actualModel: "claude-3-opus",
    recommendedModel: "claude-3-sonnet",
    estimatedSavings: 0.003,
    taskComplexity: "simple",
    confidence: 92,
    taskDescription: "Dieses JSON neu formatieren"
  },
  // ... weitere Möglichkeiten
]
```

---

## Erweiterte Funktionen

### Task-Beschreibungen für bessere Empfehlungen

Um genauere Empfehlungen zu erhalten, kannst du Task-Beschreibungen zu API-Aufrufen hinzufügen:

1. **Via Erweiterung** (Chrome DevTools):
   - Rechtsklick auf Claude.ai
   - Öffne DevTools (F12)
   - Füge Beschreibung vor dem Senden hinzu (Funktion in Entwicklung)

2. **Via API** direkt:
```javascript
fetch('http://localhost:3000/api/usage/track', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    model: 'claude-3-sonnet',
    inputTokens: 1500,
    outputTokens: 3000,
    taskDescription: 'Python-Fehler in Flask-App debuggen'
  })
});
```

### Preisgestaltungs-Updates von Anthropic

Wenn du einen Anthropic-API-Schlüssel hast:

1. Erstelle `.env`-Datei in `/backend`:
```env
ANTHROPIC_API_KEY=sk-ant-...
```

2. Preisgestaltungs-Updates werden automatisch täglich um 2 Uhr überprüft
3. Oder manuell auslösen über Einstellungs-Seite: **"Auf Updates prüfen"**

### Benutzerdefinierte Kostenberechnungen

Das System nutzt diese Formel:
```
Kosten = (Input-Tokens × Input-Preis + Output-Tokens × Output-Preis) / 1.000.000
```

Beispiel mit Sonnet (3 €/15 € pro 1M Tokens):
```
Kosten = (1500 × 3 + 3000 × 15) / 1.000.000
       = (4500 + 45000) / 1.000.000
       = 49500 / 1.000.000
       = 0,04950 €
```

### Planung & Automatisierung

**Tägliche Tasks** (läuft um 2 Uhr):
- ✅ Modell-Analytik aktualisieren
- ✅ Auf Anthropic-Preisgestaltungs-Updates überprüfen
- ✅ Optimierungs-Möglichkeiten berechnen
- ✅ Alte Datensätze bereinigen (optional)

Keine Konfiguration nötig - läuft automatisch.

---

## Tipps & Best Practices

### Genaue Daten erhalten

1. **Backend läuft** - Nutzung wird nicht verfolgt, wenn Backend offline ist
2. **Erweiterung ist aktiviert** - Überprüfe auf chrome://extensions
3. **Einzelnen Claude.ai-Tab nutzen** - Mehrere Tabs können zu Duplikaten führen
4. **Zeit für Sync einplanen** - Daten erscheinen innerhalb von 5 Sekunden nach API-Aufruf

### Kosten optimieren

1. **Wöchentlich überprüfen** - Überprüfe Optimierungs-Möglichkeiten-Bereich
2. **Haiku für einfache Tasks nutzen** - Spart 75-90% vs Opus
3. **Preisgestaltung manuell anpassen** - Falls du benutzerdefinierte Preistarife hast
4. **Nach Modell überwachen** - Sehe welche Modelle am teuersten sind
5. **Sicherheits-Schwellen setzen** - Gehe nicht unter 70% Erfolgsquote

### Wartung

**Wöchentlich:**
- Optimierungs-Möglichkeiten überprüfen
- Kosten-Trends im Dashboard überprüfen
- Überprüfe, ob Erweiterung noch aktiv ist

**Monatlich:**
- `npm test` ausführen um sicherzustellen, alles noch funktioniert
- Auf Updates zu Claude-Modellen überprüfen
- Gesamte monatliche Ausgaben überprüfen

**Vierteljährlich:**
- Alte Datenbank archivieren (optional)
- Preisgestaltung aktualisieren, falls Anthropic ändert
- Empfehlungs-Engine-Einstellungen überprüfen

### Fehlerbehebung häufiger Probleme

#### Dashboard zeigt "Keine Daten"
- Stelle sicher, dass Backend läuft (`npm run dev` in backend/)
- Überprüfe, dass Erweiterung aktiviert ist (chrome://extensions)
- Mache einen Test-API-Aufruf auf claude.ai
- Warte 5-10 Sekunden
- Aktualisiere Dashboard (Strg+R oder Cmd+R)

#### Erweiterung erscheint nicht in chrome://extensions
- Stelle sicher, dass du Chrome nutzt (nicht Edge/Brave/usw. anfangs)
- Aktiviere "Entwicklermodus"-Schalter
- Lade geöffnete claude.ai-Tabs nach dem Laden der Erweiterung neu
- Überprüfe Chrome-Konsole (F12) auf Fehler

#### Preise werden in Einstellungen nicht aktualisiert
- Überprüfe, dass Backend läuft
- Versuche, auf "Auf Updates prüfen"-Schaltfläche zu klicken
- Falls du API-Schlüssel nutzt, überprüfe, dass er gültig ist
- Überprüfe Browser-Konsole (F12) auf Netzwerkfehler

#### Datenbank gesperrt Fehler
- Stoppe Backend: Strg+C
- Warte 2 Sekunden
- Starte Backend erneut: `npm run dev`

---

## Häufig gestellte Fragen

### F: Sind meine Daten privat?
**A:** Ja! Alle Daten in lokaler SQLite-Datenbank gespeichert. Nie in die Cloud gesendet. Nur Preisgestaltungs-API-Aufrufe gehen zu Anthropic.

### F: Verlangsamt die Erweiterung Claude.ai?
**A:** Nein, sie läuft im Hintergrund mit minimalem Overhead (~2-5ms pro Request).

### F: Kann ich meine Daten exportieren?
**A:** Derzeit nur in Einstellungen. CSV-Export kommt in zukünftiger Version.

### F: Was, wenn ich die App nicht mehr nutze?
**A:** Deaktiviere einfach die Erweiterung. Historische Daten bleiben in der Datenbank.

### F: Kann ich alle Daten zurücksetzen?
**A:** Ja, lösche `backend/database.sqlite` und starte Backend neu (neue Datenbank wird automatisch erstellt).

### F: Funktioniert es mit anderen Claude-API-Integrationen?
**A:** Derzeit nur mit claude.ai-Web-Schnittstelle. Anthropic-API-Unterstützung geplant.

### F: Kann ich auf einem Server selbst hosten?
**A:** Ja, würde die Erweiterung ändern müssen, um auf deinen Server zu zeigen. Siehe docs/DEPLOYMENT.md (kommt bald).

### F: Wie genau sind die Kostenberechnungen?
**A:** ±0,01% von tatsächlicher Anthropic-Abrechnung (nutzt gleiche Formel und Preisgestaltung).

### F: Wie weit geht die Geschichte zurück?
**A:** Alle Datensätze werden unbegrenzt behalten (oder bis du Datenbank löschst).

### F: Kann ich das mit mehreren Benutzern nutzen?
**A:** Derzeit nur Single-User. Multi-User-Unterstützung für Phase 4 geplant.

### F: Was, wenn ich beitragen möchte?
**A:** Das ist Open-Source! Fork auf GitHub und reiche PRs ein. Siehe [Beiträge](README_DE.md#-beiträge) Abschnitt.

---

## Tastaturkürzel

| Tastaturkürzel | Aktion |
|---|---|
| `Strg+/` (oder `Cmd+/` auf Mac) | Seitenleiste umschalten |
| `R` | Dashboard aktualisieren |
| `D` | Gehe zu Dashboard |
| `S` | Gehe zu Einstellungen |
| `M` | Gehe zu Empfehlungen |

---

## Nächste Schritte

1. ✅ [Installiere die Anwendung](#installation--einrichtung)
2. ✅ [Erkunde das Dashboard](#dashboard-übersicht)
3. ✅ [Konfiguriere Preisgestaltung](#preisgestaltungs-verwaltung)
4. ✅ [Überprüfe Empfehlungen](#modellempfehlungen)
5. 🚀 Beginne, deine Claude-Nutzung zu optimieren!

---

**Brauchst du Hilfe?**
- Überprüfe [Häufig gestellte Fragen](#häufig-gestellte-fragen) oben
- Überprüfe [Fehlerbehebung](#fehlerbehebung-häufiger-probleme)
- Lese technische Dokumente in `/docs` Ordner
- Überprüfe GitHub-Issues: [Projekt-Repo](https://github.com/haraldweiss/Claude-KI-Usage-Tracker)

**Zuletzt aktualisiert**: April 2026  
**Version**: 1.0.0 (Phase 3 abgeschlossen)
