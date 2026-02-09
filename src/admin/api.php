<?php
/**
 * Hauspunkt – Admin API
 * Endpoints für Zähler (meters) und Ansichten (views).
 * Zähler werden über "nr" identifiziert (kein internes id-Feld).
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

require_once __DIR__ . '/../common/common.php';

hp_cors();

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// ── Zähler (Meters) ─────────────────────────────────────────────

if ($action === 'meters' && $method === 'GET') {
    $meters = hp_read_json(__DIR__ . '/data/meters.json');
    hp_json_response($meters);
}

if ($action === 'meter_save' && $method === 'POST') {
    $body = hp_get_json_body();
    $meters = hp_read_json(__DIR__ . '/data/meters.json');
    
    $nr = trim($body['nr'] ?? '');
    $origNr = trim($body['_origNr'] ?? '');
    
    $meter = [
        'nr'          => (string) $nr,
        'bezeichnung' => (string) ($body['bezeichnung'] ?? ''),
        'haus'        => (string) ($body['haus'] ?? ''),
        'einheit'     => (string) ($body['einheit'] ?? ''),
        'typ'         => (string) ($body['typ'] ?? ''),
        'faktor'      => (string) ($body['faktor'] ?? ''),
        'stichtag'    => (string) ($body['stichtag'] ?? '31.12'),
    ];
    
    if ($origNr !== '' && $origNr !== $nr) {
        // Nr wurde geändert → alten Eintrag ersetzen, Readings aktualisieren
        $found = false;
        foreach ($meters as &$m) {
            if ($m['nr'] === $origNr) {
                $m = $meter;
                $found = true;
                break;
            }
        }
        unset($m);
        if (!$found) {
            $meters[] = $meter;
        }
        // Readings: meterId von alt auf neu umschreiben
        $readingsPath = __DIR__ . '/../readings/data/readings.json';
        $readings = hp_read_json($readingsPath);
        $changed = false;
        foreach ($readings as &$r) {
            if ($r['meterId'] === $origNr) {
                $r['meterId'] = $nr;
                $changed = true;
            }
        }
        unset($r);
        if ($changed) {
            hp_write_json($readingsPath, $readings);
        }
    } else {
        // Bestehenden Eintrag suchen oder neuen anlegen
        $found = false;
        foreach ($meters as &$m) {
            if ($m['nr'] === $nr) {
                $m = $meter;
                $found = true;
                break;
            }
        }
        unset($m);
        if (!$found) {
            $meters[] = $meter;
        }
    }
    
    hp_write_json(__DIR__ . '/data/meters.json', $meters);
    hp_json_response($meter);
}

if ($action === 'meter_delete' && $method === 'POST') {
    $body = hp_get_json_body();
    $nr = trim($body['nr'] ?? '');
    
    if (empty($nr)) {
        hp_error_response('Nr fehlt.');
    }
    
    $meters = hp_read_json(__DIR__ . '/data/meters.json');
    $meters = array_values(array_filter($meters, fn($m) => $m['nr'] !== $nr));
    hp_write_json(__DIR__ . '/data/meters.json', $meters);
    
    // Zugehörige Werte aus Readings entfernen (neues Format: werte-Map)
    $readingsPath = __DIR__ . '/../readings/data/readings.json';
    $readings = hp_read_json($readingsPath);
    $changed = false;
    foreach ($readings as &$r) {
        if (isset($r['werte'][$nr])) {
            unset($r['werte'][$nr]);
            $changed = true;
        }
    }
    unset($r);
    if ($changed) {
        // Leere Readings entfernen
        $readings = array_values(array_filter($readings, fn($r) => !empty($r['werte'])));
        hp_write_json($readingsPath, $readings);
    }
    
    hp_json_response(['success' => true]);
}

// ── Ansichten (Views) ────────────────────────────────────────────

if ($action === 'views' && $method === 'GET') {
    $views = hp_read_json(__DIR__ . '/data/views.json');
    hp_json_response($views);
}

if ($action === 'view_save' && $method === 'POST') {
    $body = hp_get_json_body();
    $views = hp_read_json(__DIR__ . '/data/views.json');
    
    $id = trim($body['id'] ?? '');
    $isNew = empty($id);
    
    if ($isNew) {
        $id = hp_generate_id('v');
    }
    
    $view = [
        'id'     => (string) $id,
        'name'   => (string) ($body['name'] ?? ''),
        'filter' => $body['filter'] ?? [],
        'token'  => $isNew ? hp_generate_token() : (string) ($body['token'] ?? hp_generate_token()),
    ];
    // Optionales Feld: editableFrom (Datum ab dem Änderungen erlaubt sind)
    if (isset($body['editableFrom'])) {
        $view['editableFrom'] = (string) $body['editableFrom'];
    }
    
    if ($isNew) {
        $views[] = $view;
    } else {
        $found = false;
        foreach ($views as &$v) {
            if ($v['id'] === $id) {
                $view['token'] = $v['token'];
                // editableFrom beibehalten wenn nicht explizit gesendet
                if (!isset($body['editableFrom']) && isset($v['editableFrom'])) {
                    $view['editableFrom'] = $v['editableFrom'];
                }
                $v = $view;
                $found = true;
                break;
            }
        }
        unset($v);
        if (!$found) {
            hp_error_response('Ansicht nicht gefunden.', 404);
        }
    }
    
    hp_write_json(__DIR__ . '/data/views.json', $views);
    hp_json_response($view);
}

if ($action === 'view_delete' && $method === 'POST') {
    $body = hp_get_json_body();
    $id = trim($body['id'] ?? '');
    
    if (empty($id)) {
        hp_error_response('ID fehlt.');
    }
    
    $views = hp_read_json(__DIR__ . '/data/views.json');
    $views = array_values(array_filter($views, fn($v) => $v['id'] !== $id));
    hp_write_json(__DIR__ . '/data/views.json', $views);
    
    hp_json_response(['success' => true]);
}

// ── Ablesungen für Übersicht ─────────────────────────────────────

if ($action === 'readings' && $method === 'GET') {
    $readings = hp_read_json(__DIR__ . '/../readings/data/readings.json');
    hp_json_response($readings);
}

// ── Filter-Optionen (eindeutige Werte) ───────────────────────────

if ($action === 'filter_options' && $method === 'GET') {
    $meters = hp_read_json(__DIR__ . '/data/meters.json');
    $haeuser = [];
    $einheiten = [];
    $typen = [];
    foreach ($meters as $m) {
        if (!empty($m['haus'])) $haeuser[$m['haus']] = true;
        if (!empty($m['einheit'])) $einheiten[$m['einheit']] = true;
        if (!empty($m['typ'])) $typen[$m['typ']] = true;
    }
    hp_json_response([
        'haeuser'    => array_keys($haeuser),
        'einheiten'  => array_keys($einheiten),
        'typen'      => array_keys($typen),
    ]);
}

// ── CSV Import ───────────────────────────────────────────────────

if ($action === 'meters_import' && $method === 'POST') {
    if (!isset($_FILES['csv']) || $_FILES['csv']['error'] !== UPLOAD_ERR_OK) {
        hp_error_response('CSV-Upload fehlgeschlagen.');
    }
    
    $content = file_get_contents($_FILES['csv']['tmp_name']);
    $lines = array_filter(array_map('trim', explode("\n", $content)));
    
    if (count($lines) < 2) {
        hp_error_response('CSV muss mindestens eine Kopfzeile und eine Datenzeile enthalten.');
    }
    
    $header = str_getcsv(array_shift($lines), ';');
    $header = array_map('trim', $header);
    
    $meters = hp_read_json(__DIR__ . '/data/meters.json');
    $imported = 0;
    
    foreach ($lines as $line) {
        $cols = str_getcsv($line, ';');
        $row = [];
        foreach ($header as $i => $h) {
            $row[strtolower($h)] = (string) trim($cols[$i] ?? '');
        }
        
        $meter = [
            'nr'          => (string) ($row['nr'] ?? $row['nr.'] ?? ''),
            'bezeichnung' => (string) ($row['bezeichnung'] ?? ''),
            'haus'        => (string) ($row['haus'] ?? ''),
            'einheit'     => (string) ($row['einheit'] ?? ''),
            'typ'         => (string) ($row['typ'] ?? ''),
            'faktor'      => (string) ($row['faktor'] ?? $row['factor'] ?? ''),
            'stichtag'    => (string) ($row['stichtag'] ?? '31.12'),
        ];
        
        $meters[] = $meter;
        $imported++;
    }
    
    hp_write_json(__DIR__ . '/data/meters.json', $meters);
    hp_json_response(['imported' => $imported]);
}

// ── Reading löschen ──────────────────────────────────────────────

if ($action === 'reading_delete' && $method === 'POST') {
    $body = hp_get_json_body();
    $id = (string) ($body['id'] ?? '');
    if (empty($id)) {
        hp_error_response('ID fehlt.');
    }
    
    $readings = hp_read_json(__DIR__ . '/../readings/data/readings.json');
    $found = false;
    $readings = array_values(array_filter($readings, function($r) use ($id, &$found) {
        if ($r['id'] === $id) { $found = true; return false; }
        return true;
    }));
    
    if (!$found) {
        hp_error_response('Reading nicht gefunden.', 404);
    }
    
    hp_write_json(__DIR__ . '/../readings/data/readings.json', $readings);
    hp_json_response(['success' => true]);
}

// Fallback
hp_error_response('Unbekannte Aktion: ' . $action, 404);
