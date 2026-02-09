# Agent Rules for Hauspunkt

## Architecture & Tech Stack
- **App Name**: Hauspunkt.
- **Backend**: PHP.
- **Data Storage**: JSON files only. Every piece of data must be a **string**.
- **Frontend**: Vanilla JS (no frameworks).
- **Styling**: Lightweight, modern, and nice-looking CSS library (e.g. Pico.css or similar, agent's choice). 
- **Performance**: High-velocity vibe coding. Fast, simple, and responsive UI. **NO animations**.
- **Language**: German (Deutsch). All UI text, instructions, and labels must be in German.

## Environment & Server Rules
1.  **Subdirectory Context**: The application is intended to run in a subdirectory provided by the user. If you do not know the subdirectory, you MUST ask. It could be `./` or any other path.
2.  **Server Control**: **DO NOT** attempt to start a PHP server. The user has already started one with `php -S 0.0.0.0:1984` in the project root.
3.  **Testing**: When testing or opening browser pages, always respect the subdirectory context relative to the root URL.

## Directory Structure & Modularity
1.  **Strict Isolation**: Three independent modules: `admin`, `readings`, and `common`.
    - PHP files MUST NOT cross-reference (no `include`/`require` or server-side requests between `admin` and `readings`).
    - **Exception**: The JavaScript (frontend) in the `admin` module IS ALLOWED to make HTTP requests to `readings/api.php`.
2.  **Relative Pathing**: **CRITICAL**. The app must work in any sub-path. **NEVER** use absolute paths (starting with `/`) for CSS, JS, images, or links. Always use **relative paths** (e.g., `../common/lib/style.css`).
3.  **Local Assets**: **ALL** CSS and JS libraries must be stored locally in `common/lib/`. Do NOT use CDNs.

## Security & Reliability
1.  **Access Control**: 
    - `/admin` must be protected by Basic Auth (`.htaccess`/`.htpasswd`).
    - **User**: `admin`, **Password**: `nimda` (encoded).
    - Directory browsing must be disabled (`Options -Indexes`) in `/admin` and `/readings`.
2.  **Robustness**: `readings/api.php` MUST verify that file uploads (images) were successful.
3.  **Error Logging**: Every PHP file MUST use extensive error logging (`error_reporting(E_ALL);`, `ini_set('display_errors', 1);`).

## UI & Features
1.  **Mobile First**: Tenant interfaces must be optimized for mobile devices with simple, touch-friendly list entries.

## Coding Patterns
1.  **Function-Based PHP**: Files must encapsulate logic in functions. No immediate code execution upon `include`/`require`.
2.  **Data Persistence**: JSON filenames based on unique IDs.
3.  **Cleanup**: Deleting records MUST also delete all associated JSON files and image files.
