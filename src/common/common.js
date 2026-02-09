/**
 * Hauspunkt – Gemeinsame JS-Helfer
 */

const HP = {
    /**
     * Fetch-Wrapper mit JSON-Parsing und Fehlerbehandlung.
     */
    async api(url, options = {}) {
        try {
            if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
                options.body = JSON.stringify(options.body);
                options.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
            }
            const res = await fetch(url, options);
            const text = await res.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                data = { raw: text };
            }
            if (!res.ok) {
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            return data;
        } catch (err) {
            console.error('API-Fehler:', err);
            throw err;
        }
    },

    /**
     * Element erstellen mit Attributen und Kindern.
     */
    el(tag, attrs = {}, ...children) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'className') el.className = v;
            else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
            else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
            else el.setAttribute(k, v);
        }
        for (const child of children) {
            if (typeof child === 'string') el.appendChild(document.createTextNode(child));
            else if (child) el.appendChild(child);
        }
        return el;
    },

    /**
     * Kurzform für querySelector.
     */
    $(sel, ctx = document) {
        return ctx.querySelector(sel);
    },

    /**
     * Kurzform für querySelectorAll.
     */
    $$(sel, ctx = document) {
        return [...ctx.querySelectorAll(sel)];
    },

    /**
     * Toast-Benachrichtigung anzeigen.
     */
    toast(message, type = 'info') {
        let container = document.getElementById('hp-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'hp-toast-container';
            container.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;';
            document.body.appendChild(container);
        }
        const colors = { info: '#1095c1', success: '#2ecc71', error: '#e74c3c', warning: '#f39c12' };
        const toast = document.createElement('div');
        toast.style.cssText = `padding:0.75rem 1.25rem;border-radius:8px;color:#fff;font-size:0.9rem;background:${colors[type] || colors.info};box-shadow:0 2px 8px rgba(0,0,0,0.15);max-width:320px;word-break:break-word;`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => { toast.remove(); }, 3500);
    },

    /**
     * Datum als DD.MM.YY formatieren.
     */
    formatDate(isoDate) {
        if (!isoDate) return '';
        const parts = isoDate.split('-');
        if (parts.length !== 3) return isoDate;
        return `${parts[2]}.${parts[1]}.${parts[0].slice(2)}`;
    },

    /**
     * Heutiges Datum als YYYY-MM-DD.
     */
    today() {
        return new Date().toISOString().split('T')[0];
    },

    /**
     * Aktueller Zeitstempel als ISO-String.
     */
    now() {
        return new Date().toISOString().slice(0, 19);
    },

    /**
     * Einfaches Debounce.
     */
    debounce(fn, ms = 300) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
    },

    /**
     * URL-Parameter auslesen.
     */
    param(name) {
        return new URLSearchParams(window.location.search).get(name);
    },

    /**
     * Tabelle als CSV exportieren.
     */
    exportCSV(rows, filename = 'export.csv') {
        const csv = rows.map(row =>
            row.map(cell => {
                const str = String(cell ?? '');
                return str.includes(',') || str.includes('"') || str.includes('\n')
                    ? '"' + str.replace(/"/g, '""') + '"'
                    : str;
            }).join(',')
        ).join('\n');
        const bom = '\uFEFF';
        const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }
};
