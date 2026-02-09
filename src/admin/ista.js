/**
 * Hauspunkt – ISTA CSV Importer logic
 */

async function importISTACSV() {
    HPExport.promptFileUpload('.csv', async (file) => {
        try {
            const text = await HPExport.readFileAsText(file);
            const rows = HPExport.parseCSV(text);
            if (!rows.length) { toast('Keine Daten gefunden.', 'warn'); return; }

            // Adresse aus der ersten Zeile als Vorschlag (Spalte "adresse")
            const addr = rows[0].adresse || '';

            // Einmalige Gerätetypen sammeln
            const types = [...new Set(rows.map(r => r.gerätetyp || r.geraetetyp || '').filter(Boolean))].sort();

            // Einmalige Positionen (für Einheit) sammeln
            const positions = [...new Set(rows.map(r => (r.position || '').trim()))].sort();

            // Check wie viele Zähler bereits existieren
            const existingNrs = new Set(meters.map(m => m.nr));
            let dupCount = 0;
            const uniqueCSVNrs = new Set();
            rows.forEach(r => {
                const nr = (r.seriennummer || '').trim();
                if (nr && !uniqueCSVNrs.has(nr)) {
                    if (existingNrs.has(nr)) dupCount++;
                    uniqueCSVNrs.add(nr);
                }
            });
            const totalCount = uniqueCSVNrs.size;

            showISTAMappingModal(rows, addr, types, positions, dupCount, totalCount);
        } catch (e) {
            toast('Fehler: ' + e.message, 'err');
        }
    });
}

function showISTAMappingModal(rows, address, types, positions, dupCount, totalCount) {
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    const c = document.createElement('div');
    c.className = 'modal-c';

    let html = `<h3>ISTA Import Konfiguration</h3>`;
    if (dupCount > 0) {
        html += `<div style="background:#fff3e0;border:1px solid #ffe0b2;padding:8px;border-radius:4px;margin-bottom:12px;font-size:13px;color:#e65100">
            ⚠️ <strong>${dupCount}/${totalCount}</strong> Zähler aus dieser Datei existieren bereits im System und werden übersprungen.
        </div>`;
    } else {
        html += `<div style="background:#e8f5e9;border:1px solid #c8e6c9;padding:8px;border-radius:4px;margin-bottom:12px;font-size:13px;color:#2e7d32">
            ✅ <strong>${totalCount}</strong> neue Zähler gefunden.
        </div>`;
    }
    html += `<div class="f-row"><label>Haus Name</label><input type="text" id="ista-haus" value="${esc(address)}"></div>`;
    html += `<div class="f-row"><label>Stichtag für alle Zähler</label><input type="text" id="ista-stichtag" value="31.12" placeholder="z.B. 31.12"></div>`;

    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:15px">`;

    // Typ Mapping
    html += `<div><label style="font-size:13px;color:#666">Typ-Mapping:</label>`;
    html += `<table class="map-table">`;
    types.forEach((t) => {
        let def = '';
        if (t.toLowerCase().includes('heizkosten')) def = 'HZ';
        else if (t.toLowerCase().includes('kaltwasser')) def = 'Kaltwasser';
        else if (t.toLowerCase().includes('warmwasser')) def = 'Warmwasser';
        html += `<tr><td>${esc(t)}</td><td><input type="text" class="ista-map-typ" data-orig="${esc(t)}" value="${esc(def)}"></td></tr>`;
    });
    html += `</table></div>`;

    // Einheit Mapping
    html += `<div><label style="font-size:13px;color:#666">Einheit-Mapping:</label>`;
    html += `<table class="map-table">`;
    positions.forEach((p) => {
        const display = p || '<em>Leer / Keine Angabe</em>';
        const def = p || 'Allgemein';
        html += `<tr><td>${display}</td><td><input type="text" class="ista-map-ein" data-orig="${esc(p)}" value="${esc(def)}"></td></tr>`;
    });
    html += `</table></div>`;

    html += `</div>`; // grid end

    html += `<p style="font-size:12px;color:#888;margin-bottom:12px">Hinweis: Nr = Seriennummer, Bez = Raum + Index</p>`;
    html += `<div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="b" id="ista-cancel">Abbrechen</button>
        <button class="b b-ok" id="ista-run">Importieren</button>
    </div>`;

    c.innerHTML = html;
    ov.appendChild(c);
    document.body.appendChild(ov);

    document.getElementById('ista-cancel').onclick = () => ov.remove();
    document.getElementById('ista-run').onclick = async () => {
        const hausName = document.getElementById('ista-haus').value.trim();
        const stichtag = document.getElementById('ista-stichtag').value.trim() || '31.12';
        if (!hausName) { toast('Haus Name wird benötigt.', 'warn'); return; }

        const typMapping = {};
        c.querySelectorAll('.ista-map-typ').forEach(inp => {
            typMapping[inp.dataset.orig] = inp.value.trim();
        });

        const einMapping = {};
        c.querySelectorAll('.ista-map-ein').forEach(inp => {
            einMapping[inp.dataset.orig] = inp.value.trim();
        });

        ov.remove();
        await processISTAImport(rows, hausName, typMapping, einMapping, stichtag);
    };
}

async function processISTAImport(rows, hausName, typMapping, einMapping, stichtag) {
    const existingNrs = new Set(meters.map(m => m.nr));
    let imported = 0;
    let skipped = 0;

    // Indexer für Räume (Bezeichnung = Raum + Index)
    const roomCounters = {};

    for (const r of rows) {
        const nr = (r.seriennummer || '').trim();
        if (!nr) { skipped++; continue; }
        if (existingNrs.has(nr)) { skipped++; continue; }

        const raum = (r.raum || 'Unbekannt').trim();
        if (!roomCounters[raum]) roomCounters[raum] = 1;
        const bez = raum + ' ' + (roomCounters[raum]++);

        const gTyp = r.gerätetyp || r.geraetetyp || '';
        const mappedTyp = typMapping[gTyp] || gTyp;

        const pos = (r.position || '').trim();
        const mappedEin = einMapping[pos] || pos;

        const meter = {
            nr: nr,
            bezeichnung: bez,
            haus: hausName,
            einheit: mappedEin,
            typ: mappedTyp,
            faktor: '1.0',
            stichtag: stichtag
        };

        try {
            await HP.api(API + '?action=meter_save', { method: 'POST', body: meter });
            existingNrs.add(nr);
            imported++;
        } catch (e) {
            console.error('Import Error', e);
            skipped++;
        }
    }

    await loadAll();

    // Filter auf das importierte Haus setzen
    setSelVals(document.getElementById('f-haus'), [hausName]);
    setSelVals(document.getElementById('f-einheit'), []);
    setSelVals(document.getElementById('f-typ'), []);
    syncFiltersToUrl();
    renderMeters();

    toast(`${imported} Zähler importiert (${skipped} übersprungen).`, 'ok');
}
