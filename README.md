# Hauspunkt

**Zählerstände einfach erfassen, verwalten und auswerten.**

Hauspunkt ist eine schlanke, selbst gehostete Webanwendung zur Verwaltung von Zählerständen in Mehrfamilienhäusern, Wohnanlagen oder Gewerbeeinheiten. Verwalter pflegen Zähler und Ableser, Mieter tragen ihre Werte bequem per Smartphone ein -- ganz ohne Cloud, Abo oder Framework-Overhead.

---

## Auf einen Blick

| | |
|---|---|
| **Backend** | PHP (kein Framework) |
| **Frontend** | Vanilla JavaScript |
| **Datenhaltung** | JSON-Dateien -- keine Datenbank nötig |
| **Bibliotheken** | D3.js, SheetJS, jsPDF (lokal, kein CDN) |
| **Sprache** | Deutsch |
| **Lizenz** | MIT |

---

## Features

### Zählerverwaltung (Admin)

- **Zähler anlegen, bearbeiten und löschen** -- direkt in einer editierbaren Tabelle mit Inline-Bearbeitung
- **Felder pro Zähler**: Haus, Nr., Bezeichnung, Einheit (z.B. EG, OG), Typ (HZ, Warmwasser, Strom, ...), Faktor, Stichtag
- **Sortierung und Filterung** nach Haus, Einheit und Typ mit Multi-Select-Filtern
- **Import und Export** von Zählerlisten als CSV oder Excel
- **Schnellansicht erstellen**: Direkt aus dem aktuellen Filter eine neue Ableser-Ansicht erzeugen

### Ableser / Ansichten (Admin)

- **Ansichten definieren**: Ableser-Links mit konfigurierbaren Filtern (Haus, Einheit, Typ) erstellen
- **Individuelle Zugangslinks** pro Ableser -- keine Benutzerkonten nötig
- **Zugangsbeschränkung** (`editableFrom`): Datum festlegen, ab dem ein Ableser Änderungen vornehmen darf, mit Schnelltaste "Heute"
- **Direktlinks**: Von jeder Ansicht direkt zur Ablesung oder zum Verbrauchsdiagramm springen

### Messwerte-Übersicht (Admin)

- **Tabellarische Gesamtübersicht** aller Zählerstände quer über alle Ablesungen
- **Verschmelzung nach Datum**: Readings vom gleichen Tag werden in einer Spalte zusammengefasst, auch wenn sie von verschiedenen Ablesern stammen
- **Konflikterkennung**: Unterschiedliche Werte desselben Zählers werden rot mit `/` getrennt angezeigt (z.B. `50 (heinz) / 55 (alex)`)
- **Ablesernamen als Links**: Jeder Name im Spaltenkopf verlinkt direkt zur jeweiligen Ablesung
- **Filter** nach Haus, Einheit, Typ und Jahr
- **Sticky-Spalten** (Haus, Einheit, Nr., Bezeichnung) beim horizontalen Scrollen
- **Export** als CSV, Excel und PDF

### Ablesung (Mieter / Ableser)

- **Mobile-optimierte Eingabe** mit großen Touch-Feldern und automatischer Gruppierung nach Haus und Einheit
- **Zwei Wertarten**: M/A (Stichtagswert) und Aktuell (unterjähriger Verbrauchswert), einzeln ein-/ausblendbar
- **Datumswahl**: Werte pro Tag erfassen, Datum frei wählbar
- **Vorausfüllung von Fremdwerten**: Werte, die ein anderer Ableser am gleichen Tag erfasst hat, werden automatisch vorausgefüllt und violett markiert mit Quellenangabe
- **Sperrschutz**: Änderungen vor dem konfigurierten Datum werden blockiert (Frontend + Backend)
- **Export**: CSV, Excel und PDF (inkl. mehrspaltigem Druckformular)
- **Import**: CSV- und Excel-Dateien einlesen und als Werte übernehmen
- **Integrierte Hilfeseite** mit Anleitung für verschiedene Zählertypen (Heizung, Strom, Wasser, Gas)

### Verbrauchsdiagramm (D3.js)

- **Interaktives Liniendiagramm** mit Zeitachse für alle Zähler einer Ansicht
- **Standardansicht "Summe pro Einheit"**: Gewichtete Summe (Faktor x Wert) aller Zähler pro Einheit (EG, OG, Allgemein, ...)
- **Einzelzähler-Ansicht**: Jeden Zähler einzeln betrachten
- **Typfilter**: Nur bestimmte Zählertypen anzeigen
- **Rohwert / Gewichtet** umschaltbar
- **Zeitraumfilter** (Von / Bis)
- **Mehrachsen-Darstellung**: HZ-Zähler (dünne, durchgezogene Linien) und andere Typen (dicke, gestrichelte Linien) mit separaten Y-Achsen
- **Stichtag-Logik**: M/A-Werte werden dem korrekten Stichtag auf der X-Achse zugeordnet (nicht dem Messdatum)
- **Klickbare Datenpunkte**: Direkt zur zugehörigen Ablesung springen
- **Tooltips** mit Detailinformationen
- **URL-Persistenz**: Alle Einstellungen (Zähler, Modus, Typ, Zeitraum) werden in der URL gespeichert
- **Legende** mit farblicher Zuordnung
- **Responsive** -- funktioniert auf Desktop und Smartphone

### Datenübergreifende Features

- **Ableser-übergreifende Datenzusammenführung**: Werte von verschiedenen Ablesern für dieselben Zähler werden beim Laden zusammengeführt (eigene Werte haben Vorrang)
- **`force`-Parameter**: Links aus Admin und Diagramm springen ohne Bestätigungsdialog direkt zum richtigen Datum

### Sicherheit

- **Basic Auth** für den Admin-Bereich (`.htaccess` / `.htpasswd`)
- **Directory Browsing** deaktiviert
- **Serverseitige Validierung** aller Eingaben

---

## Verzeichnisstruktur

```
hauspunkt/
├── src/
│   ├── index.html              # Weiterleitung → admin/
│   ├── admin/
│   │   ├── api.php             # Admin-API (Zähler, Ansichten, Readings)
│   │   ├── app.js              # Admin-Frontend
│   │   ├── index.html          # Admin-Oberfläche
│   │   └── data/               # JSON-Daten (Zähler, Ansichten)
│   ├── readings/
│   │   ├── api.php             # Readings-API (Laden, Speichern, Historie)
│   │   ├── app.js              # Ableser-Frontend
│   │   ├── index.html          # Ablesung-Oberfläche
│   │   ├── chart.html          # D3.js Verbrauchsdiagramm
│   │   ├── help.html           # Hilfeseite
│   │   └── data/               # JSON-Daten (Ablesungen)
│   └── common/
│       ├── common.js           # Gemeinsame JS-Helfer
│       ├── common.php          # Gemeinsame PHP-Helfer
│       ├── export-import.js    # Export/Import-Logik
│       ├── logo.svg            # Logo
│       └── lib/                # Bibliotheken (lokal)
│           ├── d3.v7.min.js
│           ├── xlsx.full.min.js
│           ├── jspdf.umd.min.js
│           └── ...
```

---

## Installation

### Voraussetzungen

- PHP 7.4+ (kein Composer nötig)
- Webserver (Apache mit `.htaccess`-Support oder PHP Built-in Server)

### Schnellstart

```bash
# Repository klonen
git clone https://github.com/dein-user/hauspunkt.git
cd hauspunkt/src

# PHP-Server starten
php -S 0.0.0.0:1984

# Im Browser öffnen
# http://localhost:1984/
```

Der Admin-Bereich ist unter `/admin/` erreichbar (Benutzer: `admin`, Passwort: `nimda`).

### Auf einem Webserver

Einfach das `src`-Verzeichnis in ein beliebiges Unterverzeichnis des Webservers kopieren. Die Anwendung funktioniert in jedem Pfad -- es werden ausschließlich relative Pfade verwendet.

Sicherstellen, dass die `data/`-Verzeichnisse vom Webserver beschreibbar sind:

```bash
chmod 755 admin/data readings/data
```

---

## Architektur

- **Drei unabhängige Module**: `admin`, `readings` und `common`
- **Keine Cross-Referenzen** zwischen PHP-Dateien der Module
- **Alle Daten als JSON-Strings** gespeichert -- keine Datenbank erforderlich
- **Keine CDNs**: Alle Bibliotheken liegen lokal in `common/lib/`
- **Keine Build-Tools**: Kein npm, kein Bundler, kein Transpiler
- **Funktioniert offline** (nach dem ersten Laden)

---

## Lizenz

MIT License

Copyright (c) 2026 Alexander Thurn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
