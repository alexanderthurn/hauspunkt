<?php
/**
 * Hauspunkt – Gemeinsame PHP-Helfer
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

/**
 * JSON-Datei lesen. Gibt Array zurück (leeres Array bei Fehler).
 */
function hp_read_json(string $path): array {
    if (!file_exists($path)) {
        error_log("hp_read_json: Datei nicht gefunden: $path");
        return [];
    }
    $content = file_get_contents($path);
    if ($content === false) {
        error_log("hp_read_json: Konnte Datei nicht lesen: $path");
        return [];
    }
    $data = json_decode($content, true);
    if (!is_array($data)) {
        error_log("hp_read_json: Ungültiges JSON in: $path");
        return [];
    }
    return $data;
}

/**
 * JSON-Datei schreiben. Gibt true/false zurück.
 */
function hp_write_json(string $path, array $data): bool {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    $result = file_put_contents($path, $json, LOCK_EX);
    if ($result === false) {
        error_log("hp_write_json: Konnte nicht schreiben: $path");
        return false;
    }
    return true;
}

/**
 * Eindeutige ID generieren mit Präfix.
 */
function hp_generate_id(string $prefix = ''): string {
    return $prefix . '_' . bin2hex(random_bytes(6));
}

/**
 * String bereinigen (trim + htmlspecialchars).
 */
function hp_sanitize(string $input): string {
    return htmlspecialchars(trim($input), ENT_QUOTES, 'UTF-8');
}

/**
 * JSON-Response senden und beenden.
 */
function hp_json_response(array $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Fehler-Response senden.
 */
function hp_error_response(string $message, int $status = 400): void {
    hp_json_response(['error' => $message], $status);
}

/**
 * Request-Body als JSON parsen.
 */
function hp_get_json_body(): array {
    $raw = file_get_contents('php://input');
    if (empty($raw)) {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/**
 * Token generieren (URL-sicher).
 */
function hp_generate_token(): string {
    return bin2hex(random_bytes(16));
}

/**
 * CORS-Header setzen (für lokale Entwicklung).
 */
function hp_cors(): void {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}
