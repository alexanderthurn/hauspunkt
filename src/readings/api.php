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
    $datum = trim($_GET['datum'] ?? date('Y-m-d'));
    $meters = hp_read_json(__DIR__ . '/../admin/data/meters.json');
    $filter = $view['filter'] ?? [];
    $filtered = [];
    $meterNrs = [];
    foreach ($meters as $m) {
        if (!empty($filter['haus']) && $m['haus'] !== $filter['haus'])
            continue;
        if (!empty($filter['einheit']) && is_array($filter['einheit']) && count($filter['einheit']) > 0) {
            if (!in_array($m['einheit'], $filter['einheit']))
                continue;
        }
        if (!empty($filter['typ']) && $m['typ'] !== $filter['typ'])
            continue;
        $vFrom = $m['validFrom'] ?? '';
        $vTo = $m['validTo'] ?? '';
        if (!empty($vFrom) && $datum < $vFrom)
            continue;
        if (!empty($vTo) && $datum > $vTo)
            continue;
        $filtered[] = $m;
        $meterNrs[] = $m['nr'];
    }

    $readings = hp_read_json(__DIR__ . '/data/readings.json');
    $existing = [];
    $foreignSources = []; // meterId → viewName des fremden Ablesers

    // Hilfsfunktion: erlaubte Zähler-IDs für eine Ansicht (Filter-Respekt, wie in Messwerte)
    $getViewAllowedNrs = function ($viewName) use ($views, $meters, $datum) {
        foreach ($views as $v) {
            if (($v['name'] ?? '') !== $viewName) continue;
            $f = $v['filter'] ?? [];
            $out = [];
            foreach ($meters as $m) {
                if (!empty($f['haus']) && ($m['haus'] ?? '') !== $f['haus']) continue;
                if (!empty($f['einheit']) && is_array($f['einheit']) && count($f['einheit']) > 0) {
                    if (!in_array($m['einheit'] ?? '', $f['einheit'])) continue;
                }
                if (!empty($f['typ']) && ($m['typ'] ?? '') !== $f['typ']) continue;
                $vFrom = $m['validFrom'] ?? '';
                $vTo = $m['validTo'] ?? '';
                if (!empty($vFrom) && $datum < $vFrom) continue;
                if (!empty($vTo) && $datum > $vTo) continue;
                $out[] = $m['nr'];
            }
            return $out;
        }
        return [];
    };

    // Zuerst: Werte von anderen Ablesern sammeln
    // Nur Werte verwenden, wo der Zähler zur Ansicht des Readings gehört (keine Vermischung von Häusern)
    foreach ($readings as $r) {
        if ($r['datum'] !== $datum)
            continue;
        if (($r['viewName'] ?? '') === $name)
            continue; // eigene Werte kommen danach
        $readingViewAllowed = $getViewAllowedNrs($r['viewName'] ?? '');
        $werte = $r['werte'] ?? [];
        foreach ($werte as $meterId => $vals) {
            if (!in_array($meterId, $meterNrs))
                continue; // Meter gehört nicht zur ladenden Ansicht
            if (!in_array($meterId, $readingViewAllowed))
                continue; // Zähler gehört nicht zur Ansicht des Readings → ignorieren
            $ma = $vals['wertMA'] ?? '';
            $ak = $vals['wertAktuell'] ?? '';
            if ($ma !== '' || $ak !== '') {
                if (!isset($existing[$meterId])) {
                    $existing[$meterId] = [
                        'wertMA' => $ma,
                        'wertAktuell' => $ak,
                        'source' => $r['viewName'] ?? '',
                    ];
                    $foreignSources[$meterId] = $r['viewName'] ?? '';
                }
            }
        }
    }

    // Dann: Eigene Werte überschreiben (haben Vorrang)
    $notizen = '';
    $readingId = '';
    $pdf = '';
    $ownViewAllowed = $getViewAllowedNrs($name);
    foreach ($readings as $r) {
        if ($r['datum'] === $datum && ($r['viewName'] ?? '') === $name) {
            $notizen = $r['notizen'] ?? '';
            $readingId = $r['id'] ?? '';
            $pdf = $r['pdf'] ?? '';
            $werte = $r['werte'] ?? [];
            foreach ($werte as $meterId => $vals) {
                if (!in_array($meterId, $meterNrs))
                    continue;
                if (!in_array($meterId, $ownViewAllowed))
                    continue; // Fremde Zähler im eigenen Reading ignorieren
                $existing[$meterId] = [
                    'wertMA' => $vals['wertMA'] ?? '',
                    'wertAktuell' => $vals['wertAktuell'] ?? '',
                ];
                unset($foreignSources[$meterId]);
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
        'view' => [
            'id' => $view['id'],
            'name' => $view['name'],
            'editableFrom' => $view['editableFrom'] ?? '',
            'editableUntil' => $view['editableUntil'] ?? ''
        ],
        'meters' => $filtered,
        'datum' => $datum,
        'readingId' => $readingId,
        'pdf' => $pdf,
        'existing' => $existing,
        'notizen' => $notizen,
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
    $notizen = (string) ($body['notizen'] ?? '');
    $zeitstempel = date('Y-m-d\TH:i:s');

    // Prüfung: editableFrom – Datum darf nicht vor dem erlaubten Zeitraum liegen
    if (!empty($viewName)) {
        $views = hp_read_json(__DIR__ . '/../admin/data/views.json');
        foreach ($views as $v) {
            if ($v['name'] === $viewName) {
                $editableFrom = $v['editableFrom'] ?? '';
                $editableUntil = $v['editableUntil'] ?? '';
                if (!empty($editableFrom) && $datum < $editableFrom) {
                    hp_error_response('Änderungen vor dem ' . date('d.m.Y', strtotime($editableFrom)) . ' sind nicht erlaubt.');
                }
                if (!empty($editableUntil) && $datum > $editableUntil) {
                    hp_error_response('Änderungen nach dem ' . date('d.m.Y', strtotime($editableUntil)) . ' sind nicht erlaubt.');
                }
                break;
            }
        }
    }

    // Erlaubte Zähler-IDs für diese Ansicht (Filter prüfen)
    $allowedMeterNrs = [];
    if (!empty($viewName)) {
        $views = hp_read_json(__DIR__ . '/../admin/data/views.json');
        $view = null;
        foreach ($views as $v) {
            if ($v['name'] === $viewName) {
                $view = $v;
                break;
            }
        }
        if ($view) {
            $meters = hp_read_json(__DIR__ . '/../admin/data/meters.json');
            $filter = $view['filter'] ?? [];
            foreach ($meters as $m) {
                if (!empty($filter['haus']) && ($m['haus'] ?? '') !== $filter['haus'])
                    continue;
                if (!empty($filter['einheit']) && is_array($filter['einheit']) && count($filter['einheit']) > 0) {
                    if (!in_array($m['einheit'] ?? '', $filter['einheit']))
                        continue;
                }
                if (!empty($filter['typ']) && ($m['typ'] ?? '') !== $filter['typ'])
                    continue;
                $vFrom = $m['validFrom'] ?? '';
                $vTo = $m['validTo'] ?? '';
                if (!empty($vFrom) && $datum < $vFrom)
                    continue;
                if (!empty($vTo) && $datum > $vTo)
                    continue;
                $allowedMeterNrs[] = $m['nr'];
            }
        }
    }
    $allowedSet = array_flip($allowedMeterNrs); // für schnelle O(1)-Prüfung

    // Werte-Map aus Entries bauen – nur erlaubte Zähler übernehmen
    $newWerte = [];
    foreach ($entries as $entry) {
        $meterId = (string) ($entry['meterId'] ?? '');
        if ($meterId === '')
            continue;
        if (!empty($allowedSet) && !isset($allowedSet[$meterId]))
            continue; // Zähler gehört nicht zur Ansicht → ignorieren
        $wertMA = (string) ($entry['wertMA'] ?? '');
        $wertAktuell = (string) ($entry['wertAktuell'] ?? '');
        $newWerte[$meterId] = ['wertMA' => $wertMA, 'wertAktuell' => $wertAktuell];
    }

    if (empty($entries)) {
        hp_json_response(['saved' => 0]);
    }

    $readings = hp_read_json(__DIR__ . '/data/readings.json');

    // Upsert: existierenden Eintrag für datum+viewName suchen
    $found = false;
    foreach ($readings as &$r) {
        if ($r['datum'] === $datum && ($r['viewName'] ?? '') === $viewName) {
            if (!isset($r['werte']))
                $r['werte'] = [];
            foreach ($newWerte as $mid => $vals) {
                $r['werte'][$mid] = $vals;
            }
            // Fremde Zähler-IDs entfernen (sollten nicht zur Ansicht gehören)
            if (!empty($allowedSet)) {
                $r['werte'] = array_intersect_key($r['werte'], $allowedSet);
            }
            $r['notizen'] = $notizen;
            $r['zeitstempel'] = $zeitstempel;
            $found = true;
            break;
        }
    }
    unset($r);

    if (!$found && !empty($newWerte)) {
        $readings[] = [
            'id' => hp_generate_id('r'),
            'datum' => $datum,
            'viewName' => $viewName,
            'notizen' => $notizen,
            'zeitstempel' => $zeitstempel,
            'werte' => $newWerte,
        ];
    }

    hp_write_json(__DIR__ . '/data/readings.json', $readings);

    // ID des gespeicherten Eintrags finden für Rückgabe
    $finalId = '';
    foreach ($readings as $r) {
        if ($r['datum'] === $datum && ($r['viewName'] ?? '') === $viewName) {
            $finalId = $r['id'];
            break;
        }
    }

    hp_json_response(['saved' => count($newWerte), 'id' => $finalId]);
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
        if (empty($m['nr']))
            continue;
        if (!empty($filter['haus']) && $m['haus'] !== $filter['haus'])
            continue;
        if (!empty($filter['einheit']) && is_array($filter['einheit']) && count($filter['einheit']) > 0) {
            if (!in_array($m['einheit'], $filter['einheit']))
                continue;
        }
        if (!empty($filter['typ']) && $m['typ'] !== $filter['typ'])
            continue;
        // In der Historie zeigen wir alle Zähler, die zur Ansicht gehören. 
        // Die zeitliche Filterung erfolgt bei der Zuordnung der Werte.
        $filtered[] = $m;
        $meterNrs[] = $m['nr'];
    }

    // Hilfsfunktion: erlaubte Zähler-IDs für eine Ansicht (Filter-Respekt)
    $getViewAllowedNrs = function ($viewName, $datum) use ($views, $meters) {
        foreach ($views as $v) {
            if (($v['name'] ?? '') !== $viewName) continue;
            $f = $v['filter'] ?? [];
            $out = [];
            foreach ($meters as $m) {
                if (empty($m['nr'])) continue;
                if (!empty($f['haus']) && ($m['haus'] ?? '') !== $f['haus']) continue;
                if (!empty($f['einheit']) && is_array($f['einheit']) && count($f['einheit']) > 0) {
                    if (!in_array($m['einheit'] ?? '', $f['einheit'])) continue;
                }
                if (!empty($f['typ']) && ($m['typ'] ?? '') !== $f['typ']) continue;
                $vFrom = $m['validFrom'] ?? '';
                $vTo = $m['validTo'] ?? '';
                if (!empty($vFrom) && $datum < $vFrom) continue;
                if (!empty($vTo) && $datum > $vTo) continue;
                $out[] = $m['nr'];
            }
            return $out;
        }
        return [];
    };

    $allReadings = hp_read_json(__DIR__ . '/data/readings.json');

    // Schritt 1: alle Readings pro Datum sammeln (eigene zuerst)
    // Nur Werte verwenden, wo der Zähler zur Ansicht des Readings gehört
    $byDate = [];
    foreach ($allReadings as $r) {
        $d = $r['datum'];
        $readingViewAllowed = $getViewAllowedNrs($r['viewName'] ?? '', $d);
        $werte = $r['werte'] ?? [];
        $relevantWerte = [];
        foreach ($werte as $meterId => $vals) {
            if (!in_array($meterId, $meterNrs)) continue;
            if (!in_array($meterId, $readingViewAllowed)) continue;
            $relevantWerte[$meterId] = [
                'wertMA' => $vals['wertMA'] ?? '',
                'wertAktuell' => $vals['wertAktuell'] ?? '',
            ];
        }
        if (empty($relevantWerte)) continue;

        if (!isset($byDate[$d])) {
            $byDate[$d] = ['own' => [], 'others' => []];
        }
        if (($r['viewName'] ?? '') === $name) {
            foreach ($relevantWerte as $mid => $v) {
                $byDate[$d]['own'][$mid] = $v;
            }
        } else {
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
                        if (($merged[$mid]['wertMA'] ?? '') === '' && $ma !== '')
                            $merged[$mid]['wertMA'] = $ma;
                        if (($merged[$mid]['wertAktuell'] ?? '') === '' && $ak !== '')
                            $merged[$mid]['wertAktuell'] = $ak;
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
    usort($history, function ($a, $b) {
        return strcmp($a['datum'], $b['datum']);
    });

    hp_json_response([
        'view' => ['id' => $view['id'], 'name' => $view['name']],
        'meters' => $filtered,
        'readings' => $history,
    ]);
}

// ── Foto-Upload ──────────────────────────────────────────────────

if ($action === 'upload_pdf' && $method === 'POST') {
    if (!isset($_FILES['pdf']) || $_FILES['pdf']['error'] !== UPLOAD_ERR_OK) {
        hp_error_response('PDF-Upload fehlgeschlagen.');
    }

    $readingId = trim($_POST['readingId'] ?? '');
    if (empty($readingId)) {
        hp_error_response('Reading-ID fehlt. Bitte zuerst speichern.');
    }

    $uploadsDir = __DIR__ . '/uploads/';
    if (!is_dir($uploadsDir)) {
        mkdir($uploadsDir, 0755, true);
    }

    $filename = 'signed_' . $readingId . '.pdf';
    $targetPath = $uploadsDir . $filename;

    if (!move_uploaded_file($_FILES['pdf']['tmp_name'], $targetPath)) {
        hp_error_response('PDF konnte nicht gespeichert werden.');
    }

    $readings = hp_read_json(__DIR__ . '/data/readings.json');
    $found = false;
    foreach ($readings as &$r) {
        if ($r['id'] === $readingId) {
            $r['pdf'] = 'uploads/' . $filename;
            $found = true;
            break;
        }
    }
    unset($r);
    if ($found) {
        hp_write_json(__DIR__ . '/data/readings.json', $readings);
        hp_json_response(['pdf' => 'uploads/' . $filename]);
    } else {
        hp_error_response('Reading nicht gefunden.');
    }
}

// Fallback
hp_error_response('Unbekannte Aktion: ' . $action, 404);
