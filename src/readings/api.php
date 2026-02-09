<?php
/**
 * Hauspunkt – Readings API
 * Endpoints für Ablesungen (readings) und Meter-Abfrage per Name.
 * Zähler werden über "nr" identifiziert.
 * 
 * Datenmodell Reading (neues Format):
 *   id, datum, viewName, zeitstempel, werte: { meterId: { wertMA, wertAktuell }, ... }
 * 
 * Unique per datum + viewName. Upsert: gleicher Tag + View → werte mergen/überschreiben.
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

require_once __DIR__ . '/../common/common.php';

hp_cors();

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// ── Zähler + bestehende Readings für Ansicht laden ──────────────

if ($action === 'load' && $method === 'GET') {
    $name = trim($_GET['name'] ?? '');
    if (empty($name)) {
        hp_error_response('Name fehlt.');
    }
    
    $views = hp_read_json(__DIR__ . '/../admin/data/views.json');
    $view = null;
    foreach ($views as $v) {
        if ($v['name'] === $name) {
            $view = $v;
            break;
        }
    }
    if (!$view) {
        hp_error_response('Ansicht nicht gefunden.', 404);
    }
    
    // Zähler laden und filtern
    $meters = hp_read_json(__DIR__ . '/../admin/data/meters.json');
    $filter = $view['filter'] ?? [];
    $filtered = [];
    $meterNrs = [];
    foreach ($meters as $m) {
        if (!empty($filter['haus']) && $m['haus'] !== $filter['haus']) continue;
        if (!empty($filter['einheit']) && is_array($filter['einheit']) && count($filter['einheit']) > 0) {
            if (!in_array($m['einheit'], $filter['einheit'])) continue;
        }
        if (!empty($filter['typ']) && $m['typ'] !== $filter['typ']) continue;
        $filtered[] = $m;
        $meterNrs[] = $m['nr'];
    }
    
    // Bestehende Readings für gewähltes Datum laden
    // 1) Werte von ALLEN Ablesern für diesen Tag sammeln (für die Zähler, auf die diese Ansicht Zugriff hat)
    // 2) Eigene Werte haben Priorität und überschreiben fremde
    $datum = trim($_GET['datum'] ?? date('Y-m-d'));
    $readings = hp_read_json(__DIR__ . '/data/readings.json');
    $existing = [];
    $foreignSources = []; // meterId → viewName des fremden Ablesers

    // Zuerst: Werte von anderen Ablesern sammeln
    foreach ($readings as $r) {
        if ($r['datum'] !== $datum) continue;
        if (($r['viewName'] ?? '') === $name) continue; // eigene Werte kommen danach
        $werte = $r['werte'] ?? [];
        foreach ($werte as $meterId => $vals) {
            if (in_array($meterId, $meterNrs)) {
                $ma = $vals['wertMA'] ?? '';
                $ak = $vals['wertAktuell'] ?? '';
                if ($ma !== '' || $ak !== '') {
                    // Nur setzen, wenn noch nicht von einem anderen fremden Ableser belegt
                    if (!isset($existing[$meterId])) {
                        $existing[$meterId] = [
                            'wertMA'      => $ma,
                            'wertAktuell' => $ak,
                            'source'      => $r['viewName'] ?? '',
                        ];
                        $foreignSources[$meterId] = $r['viewName'] ?? '';
                    }
                }
            }
        }
    }

    // Dann: Eigene Werte überschreiben (haben Vorrang)
    foreach ($readings as $r) {
        if ($r['datum'] === $datum && ($r['viewName'] ?? '') === $name) {
            $werte = $r['werte'] ?? [];
            foreach ($werte as $meterId => $vals) {
                if (in_array($meterId, $meterNrs)) {
                    $existing[$meterId] = [
                        'wertMA'      => $vals['wertMA'] ?? '',
                        'wertAktuell' => $vals['wertAktuell'] ?? '',
                    ];
                    // Eigene Werte → kein fremder Source mehr
                    unset($foreignSources[$meterId]);
                }
            }
            break;
        }
    }

    // source-Feld entfernen, dafür foreignSources separat zurückgeben
    foreach ($existing as $meterId => &$vals) {
        unset($vals['source']);
    }
    unset($vals);
    
    hp_json_response([
        'view'           => ['id' => $view['id'], 'name' => $view['name'], 'editableFrom' => $view['editableFrom'] ?? ''],
        'meters'         => $filtered,
        'datum'          => $datum,
        'existing'       => $existing,
        'foreignSources' => $foreignSources,
    ]);
}

// ── Ablesungen speichern (upsert: datum+viewName) ───────────────

if ($action === 'save' && $method === 'POST') {
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    
    if (strpos($contentType, 'application/json') === false) {
        hp_error_response('Ungültiger Content-Type.');
    }
    
    $body = hp_get_json_body();
    $entries = $body['entries'] ?? [];
    $datum = (string) ($body['datum'] ?? date('Y-m-d'));
    $viewName = (string) ($body['viewName'] ?? '');
    $zeitstempel = date('Y-m-d\TH:i:s');
    
    // Prüfung: editableFrom – Datum darf nicht vor dem erlaubten Zeitraum liegen
    if (!empty($viewName)) {
        $views = hp_read_json(__DIR__ . '/../admin/data/views.json');
        foreach ($views as $v) {
            if ($v['name'] === $viewName) {
                $editableFrom = $v['editableFrom'] ?? '';
                if (!empty($editableFrom) && $datum < $editableFrom) {
                    hp_error_response('Änderungen vor dem ' . date('d.m.Y', strtotime($editableFrom)) . ' sind nicht erlaubt.');
                }
                break;
            }
        }
    }
    
    // Werte-Map aus Entries bauen
    $newWerte = [];
    foreach ($entries as $entry) {
        $meterId = (string) ($entry['meterId'] ?? '');
        $wertMA = (string) ($entry['wertMA'] ?? '');
        $wertAktuell = (string) ($entry['wertAktuell'] ?? '');
        if ($meterId === '') continue;
        $newWerte[$meterId] = ['wertMA' => $wertMA, 'wertAktuell' => $wertAktuell];
    }
    
    if (empty($newWerte)) {
        hp_json_response(['saved' => 0]);
    }
    
    $readings = hp_read_json(__DIR__ . '/data/readings.json');
    
    // Upsert: existierenden Eintrag für datum+viewName suchen
    $found = false;
    foreach ($readings as &$r) {
        if ($r['datum'] === $datum && ($r['viewName'] ?? '') === $viewName) {
            // Bestehende Werte mergen/überschreiben
            if (!isset($r['werte'])) $r['werte'] = [];
            foreach ($newWerte as $mid => $vals) {
                $r['werte'][$mid] = $vals;
            }
            $r['zeitstempel'] = $zeitstempel;
            $found = true;
            break;
        }
    }
    unset($r);
    
    if (!$found) {
        $readings[] = [
            'id'          => hp_generate_id('r'),
            'datum'       => $datum,
            'viewName'    => $viewName,
            'zeitstempel' => $zeitstempel,
            'werte'       => $newWerte,
        ];
    }
    
    hp_write_json(__DIR__ . '/data/readings.json', $readings);
    hp_json_response(['saved' => count($newWerte)]);
}

// ── Historie aller Readings für eine Ansicht ─────────────────────

if ($action === 'history' && $method === 'GET') {
    $name = trim($_GET['name'] ?? '');
    if (empty($name)) {
        hp_error_response('Name fehlt.');
    }

    $views = hp_read_json(__DIR__ . '/../admin/data/views.json');
    $view = null;
    foreach ($views as $v) {
        if ($v['name'] === $name) {
            $view = $v;
            break;
        }
    }
    if (!$view) {
        hp_error_response('Ansicht nicht gefunden.', 404);
    }

    // Zähler laden und filtern
    $meters = hp_read_json(__DIR__ . '/../admin/data/meters.json');
    $filter = $view['filter'] ?? [];
    $filtered = [];
    $meterNrs = [];
    foreach ($meters as $m) {
        if (empty($m['nr'])) continue;
        if (!empty($filter['haus']) && $m['haus'] !== $filter['haus']) continue;
        if (!empty($filter['einheit']) && is_array($filter['einheit']) && count($filter['einheit']) > 0) {
            if (!in_array($m['einheit'], $filter['einheit'])) continue;
        }
        if (!empty($filter['typ']) && $m['typ'] !== $filter['typ']) continue;
        $filtered[] = $m;
        $meterNrs[] = $m['nr'];
    }

    // Alle Readings laden und Werte für die Zähler dieser Ansicht sammeln
    // Einbezogen werden ALLE Readings (auch von anderen Ablesern), sofern
    // sie Werte für Zähler enthalten, auf die diese Ansicht Zugriff hat.
    // Pro Datum werden die Werte zusammengeführt: eigene Ansicht hat Priorität,
    // dann werden fehlende Werte von anderen Ablesern ergänzt.
    $allReadings = hp_read_json(__DIR__ . '/data/readings.json');

    // Schritt 1: alle Readings pro Datum sammeln (eigene zuerst)
    $byDate = []; // datum → [ 'own' => werte, 'others' => [ werte, ... ] ]
    foreach ($allReadings as $r) {
        $werte = $r['werte'] ?? [];
        $relevantWerte = [];
        foreach ($werte as $meterId => $vals) {
            if (in_array($meterId, $meterNrs)) {
                $relevantWerte[$meterId] = [
                    'wertMA'      => $vals['wertMA'] ?? '',
                    'wertAktuell' => $vals['wertAktuell'] ?? '',
                ];
            }
        }
        if (empty($relevantWerte)) continue;

        $d = $r['datum'];
        if (!isset($byDate[$d])) {
            $byDate[$d] = ['own' => [], 'others' => []];
        }
        if (($r['viewName'] ?? '') === $name) {
            // Eigene Werte
            foreach ($relevantWerte as $mid => $v) {
                $byDate[$d]['own'][$mid] = $v;
            }
        } else {
            // Fremde Werte
            $byDate[$d]['others'][] = $relevantWerte;
        }
    }

    // Schritt 2: pro Datum zusammenführen (eigene Werte haben Vorrang)
    $history = [];
    foreach ($byDate as $datum => $data) {
        $merged = [];
        // Zuerst fremde Werte einfügen
        foreach ($data['others'] as $otherWerte) {
            foreach ($otherWerte as $mid => $v) {
                $ma = $v['wertMA'] ?? '';
                $ak = $v['wertAktuell'] ?? '';
                if ($ma !== '' || $ak !== '') {
                    if (!isset($merged[$mid])) {
                        $merged[$mid] = $v;
                    } else {
                        // Ergänzen, nicht überschreiben
                        if (($merged[$mid]['wertMA'] ?? '') === '' && $ma !== '') $merged[$mid]['wertMA'] = $ma;
                        if (($merged[$mid]['wertAktuell'] ?? '') === '' && $ak !== '') $merged[$mid]['wertAktuell'] = $ak;
                    }
                }
            }
        }
        // Dann eigene Werte drüberlegen (Vorrang)
        foreach ($data['own'] as $mid => $v) {
            $merged[$mid] = $v;
        }
        if (!empty($merged)) {
            $history[] = [
                'datum' => $datum,
                'werte' => $merged,
            ];
        }
    }

    // Nach Datum sortieren
    usort($history, function($a, $b) {
        return strcmp($a['datum'], $b['datum']);
    });

    hp_json_response([
        'view'     => ['id' => $view['id'], 'name' => $view['name']],
        'meters'   => $filtered,
        'readings' => $history,
    ]);
}

// ── Foto-Upload ──────────────────────────────────────────────────

if ($action === 'upload_photo' && $method === 'POST') {
    if (!isset($_FILES['photo']) || $_FILES['photo']['error'] !== UPLOAD_ERR_OK) {
        hp_error_response('Foto-Upload fehlgeschlagen. Error-Code: ' . ($_FILES['photo']['error'] ?? 'unbekannt'));
    }
    
    $readingId = trim($_POST['readingId'] ?? '');
    if (empty($readingId)) {
        hp_error_response('Reading-ID fehlt.');
    }
    
    $uploadsDir = __DIR__ . '/uploads/';
    if (!is_dir($uploadsDir)) {
        mkdir($uploadsDir, 0755, true);
    }
    
    $ext = strtolower(pathinfo($_FILES['photo']['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp'])) {
        $ext = 'jpg';
    }
    $filename = $readingId . '.' . $ext;
    $targetPath = $uploadsDir . $filename;
    
    if (!move_uploaded_file($_FILES['photo']['tmp_name'], $targetPath)) {
        hp_error_response('Foto konnte nicht gespeichert werden.');
    }
    
    $readings = hp_read_json(__DIR__ . '/data/readings.json');
    foreach ($readings as &$r) {
        if ($r['id'] === $readingId) {
            $r['foto'] = 'uploads/' . $filename;
            break;
        }
    }
    unset($r);
    hp_write_json(__DIR__ . '/data/readings.json', $readings);
    
    hp_json_response(['foto' => 'uploads/' . $filename]);
}

// Fallback
hp_error_response('Unbekannte Aktion: ' . $action, 404);
