<?php
/**
 * Hauspunkt – Backup API
 * - Download: ZIP mit admin/data/*.json, readings/data/*.json, readings/uploads/*
 * - Upload: ZIP einspielen, nur erlaubte Pfade, Report mit neu/überschrieben
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

require_once __DIR__ . '/../common/common.php';

hp_cors();

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if (!class_exists('ZipArchive')) {
    hp_error_response('ZipArchive ist auf dem Server nicht verfügbar.', 500);
}

if ($action === 'download' && $method === 'GET') {
    hp_backup_download();
}

if ($action === 'upload' && $method === 'POST') {
    hp_backup_upload();
}

hp_error_response('Unbekannte Aktion: ' . $action, 404);

function hp_backup_download(): void
{
    $zipPath = tempnam(sys_get_temp_dir(), 'hp_backup_');
    if ($zipPath === false) {
        hp_error_response('Konnte temporäre Datei für Backup nicht erstellen.', 500);
    }

    $zip = new ZipArchive();
    $open = $zip->open($zipPath, ZipArchive::OVERWRITE);
    if ($open !== true) {
        @unlink($zipPath);
        hp_error_response('Konnte ZIP nicht erstellen.', 500);
    }

    try {
        $added = 0;
        $added += hp_backup_add_files($zip, __DIR__ . '/data', 'admin/data', true);
        $added += hp_backup_add_files($zip, __DIR__ . '/../readings/data', 'readings/data', true);
        $added += hp_backup_add_files($zip, __DIR__ . '/../readings/uploads', 'readings/uploads', false);

        $zip->close();

        $fileName = 'hp_backup_' . date('Y-m-d') . '.zip';
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="' . $fileName . '"');
        header('Content-Length: ' . filesize($zipPath));
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        readfile($zipPath);
        @unlink($zipPath);
        exit;
    } catch (Throwable $e) {
        if ($zip instanceof ZipArchive) {
            $zip->close();
        }
        @unlink($zipPath);
        hp_error_response('Backup-Fehler: ' . $e->getMessage(), 500);
    }
}

function hp_backup_upload(): void
{
    if (!isset($_FILES['backup']) || !is_array($_FILES['backup'])) {
        hp_error_response('Keine Backup-Datei empfangen.');
    }
    if (($_FILES['backup']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        hp_error_response('Backup-Upload fehlgeschlagen (Code ' . (int) $_FILES['backup']['error'] . ').');
    }

    $tmpFile = (string) ($_FILES['backup']['tmp_name'] ?? '');
    if ($tmpFile === '' || !is_uploaded_file($tmpFile)) {
        hp_error_response('Ungültige Upload-Datei.');
    }

    $zip = new ZipArchive();
    $open = $zip->open($tmpFile);
    if ($open !== true) {
        hp_error_response('ZIP konnte nicht geöffnet werden.');
    }

    $baseDir = realpath(__DIR__ . '/..');
    if ($baseDir === false) {
        $zip->close();
        hp_error_response('Basisverzeichnis nicht gefunden.', 500);
    }

    $created = [];
    $overwritten = [];
    $skipped = [];

    for ($i = 0; $i < $zip->numFiles; $i++) {
        $stat = $zip->statIndex($i);
        $entryName = $stat['name'] ?? '';
        if ($entryName === '' || substr($entryName, -1) === '/') {
            continue;
        }

        $entry = hp_normalize_zip_path($entryName);
        if ($entry === '') {
            $skipped[] = $entryName . ' (ungültiger Pfad)';
            continue;
        }

        $targetRel = hp_backup_map_allowed_entry($entry);
        if ($targetRel === null) {
            $skipped[] = $entry . ' (nicht erlaubt)';
            continue;
        }

        $targetAbs = $baseDir . '/' . $targetRel;
        if (!hp_backup_is_inside_base($baseDir, $targetAbs)) {
            $skipped[] = $entry . ' (Pfad außerhalb Backup-Bereich)';
            continue;
        }

        $targetDir = dirname($targetAbs);
        if (!is_dir($targetDir) && !mkdir($targetDir, 0755, true) && !is_dir($targetDir)) {
            $skipped[] = $targetRel . ' (Zielordner konnte nicht erstellt werden)';
            continue;
        }

        $wasExisting = file_exists($targetAbs);
        $in = $zip->getStream($entryName);
        if ($in === false) {
            $skipped[] = $targetRel . ' (Eintrag konnte nicht gelesen werden)';
            continue;
        }
        $out = @fopen($targetAbs, 'wb');
        if ($out === false) {
            fclose($in);
            $skipped[] = $targetRel . ' (Datei konnte nicht geschrieben werden)';
            continue;
        }

        $copied = stream_copy_to_stream($in, $out);
        fclose($in);
        fclose($out);

        if ($copied === false) {
            $skipped[] = $targetRel . ' (Schreibfehler)';
            continue;
        }

        if ($wasExisting) {
            $overwritten[] = $targetRel;
        } else {
            $created[] = $targetRel;
        }
    }

    $zip->close();

    if (!count($created) && !count($overwritten)) {
        hp_error_response('Keine gültigen Dateien im Backup gefunden.');
    }

    hp_json_response([
        'success' => true,
        'created' => $created,
        'overwritten' => $overwritten,
        'skipped' => $skipped,
        'counts' => [
            'created' => count($created),
            'overwritten' => count($overwritten),
            'skipped' => count($skipped),
        ],
    ]);
}

function hp_backup_add_files(ZipArchive $zip, string $sourceDir, string $zipPrefix, bool $jsonOnly): int
{
    if (!is_dir($sourceDir)) {
        return 0;
    }

    $count = 0;
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($sourceDir, FilesystemIterator::SKIP_DOTS)
    );
    $prefixLen = strlen(rtrim($sourceDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR);

    /** @var SplFileInfo $file */
    foreach ($it as $file) {
        if (!$file->isFile()) {
            continue;
        }
        $path = $file->getPathname();
        if ($jsonOnly && strtolower(pathinfo($path, PATHINFO_EXTENSION)) !== 'json') {
            continue;
        }
        $rel = str_replace('\\', '/', substr($path, $prefixLen));
        $zip->addFile($path, trim($zipPrefix, '/') . '/' . ltrim($rel, '/'));
        $count++;
    }

    return $count;
}

function hp_normalize_zip_path(string $path): string
{
    $path = str_replace('\\', '/', $path);
    $path = preg_replace('#/+#', '/', $path);
    $path = ltrim($path, '/');
    while (hp_starts_with($path, './')) {
        $path = substr($path, 2);
    }
    if ($path === '') {
        return '';
    }

    $parts = explode('/', $path);
    foreach ($parts as $p) {
        if ($p === '' || $p === '.' || $p === '..') {
            return '';
        }
    }
    return $path;
}

function hp_backup_map_allowed_entry(string $entry): ?string
{
    $entry = str_replace('\\', '/', $entry);

    if (hp_starts_with($entry, 'admin/data/')) {
        return strtolower(pathinfo($entry, PATHINFO_EXTENSION)) === 'json' ? $entry : null;
    }
    if (hp_starts_with($entry, 'readings/data/')) {
        return strtolower(pathinfo($entry, PATHINFO_EXTENSION)) === 'json' ? $entry : null;
    }
    if (hp_starts_with($entry, 'readings/uploads/')) {
        return $entry;
    }
    return null;
}

function hp_backup_is_inside_base(string $baseDir, string $targetAbs): bool
{
    $base = rtrim(str_replace('\\', '/', $baseDir), '/') . '/';
    $target = str_replace('\\', '/', $targetAbs);
    return hp_starts_with($target, $base);
}

function hp_starts_with(string $haystack, string $needle): bool
{
    return substr($haystack, 0, strlen($needle)) === $needle;
}
