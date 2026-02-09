/**
 * Hauspunkt – Readings (Mieter-Interface)
 * Zähler werden über "nr" identifiziert.
 * Pro Zähler+Tag: wertMA und wertAktuell.
 * Tagesweise upsert — gleicher Tag überschreibt.
 */

var API = 'api.php';
var viewData = null;
var showMA = true;
var showAktuell = false;
var currentDatum = '';

document.addEventListener('DOMContentLoaded', init);

async function init() {
    var name = new URLSearchParams(window.location.search).get('name');
    if (!name) {
        document.getElementById('app').innerHTML = '<div class="hp-err">Kein Ansichtsname. Bitte den erhaltenen Link verwenden.</div>';
        return;
    }
    try {
        var res = await fetch(API + '?action=load&name=' + encodeURIComponent(name));
        if (!res.ok) { var e = await res.json().catch(function () { return {}; }); throw new Error(e.error || 'HTTP ' + res.status); }
        viewData = await res.json();
        if (!viewData || !viewData.meters || !Array.isArray(viewData.meters)) throw new Error('Keine Zähler');
        var heute = new Date().toISOString().slice(0, 10);
        currentDatum = heute;

        // Spaltenauswahl aus URL laden
        var urlParams = new URLSearchParams(window.location.search);
        var cols = urlParams.get('cols');
        if (cols !== null) {
            if (cols === 'none') {
                showMA = false;
                showAktuell = false;
            } else {
                var colList = cols.split(',').filter(Boolean);
                showMA = colList.indexOf('ma') !== -1;
                showAktuell = colList.indexOf('aktuell') !== -1;
            }
        }

        // Datum aus URL laden — nachfragen wenn nicht heute (außer force=1)
        var urlDatum = urlParams.get('datum');
        var forceLoad = urlParams.get('force') === '1';
        if (urlDatum && urlDatum !== heute) {
            var shouldLoad = forceLoad || confirm('Gespeichertes Datum: ' + formatDateDE(urlDatum) + '\nAuf diesen Tag springen?');
            if (shouldLoad) {
                currentDatum = urlDatum;
                // Daten für das gespeicherte Datum nachladen
                var res2 = await fetch(API + '?action=load&name=' + encodeURIComponent(name) + '&datum=' + encodeURIComponent(urlDatum));
                if (res2.ok) {
                    var data2 = await res2.json();
                    viewData.existing = data2.existing || {};
                    viewData.foreignSources = data2.foreignSources || {};
                }
            } else {
                // Datum aus URL entfernen
                removeDatumFromUrl();
            }
        } else if (urlDatum === heute) {
            currentDatum = heute;
        }

        // force-Parameter aus URL entfernen
        if (forceLoad) {
            var cleanParams = new URLSearchParams(window.location.search);
            cleanParams.delete('force');
            history.replaceState(null, '', window.location.pathname + '?' + cleanParams.toString());
        }

        // Logo: zurück zum Default (nur name behalten)
        document.getElementById('logo-link').href = window.location.pathname + '?name=' + encodeURIComponent(name);

        initBurgerMenu();
        render();
    } catch (e) {
        document.getElementById('app').innerHTML = '<div class="hp-err">Ungültiger Link.<br><small style="color:#999">' + esc(e.message) + '</small></div>';
    }
}

function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function isDateLocked() {
    var editableFrom = viewData.view.editableFrom || '';
    if (!editableFrom) return false;
    return currentDatum < editableFrom;
}

function render() {
    document.getElementById('hdr-title').textContent = viewData.view.name;
    var existing = viewData.existing || {};
    var foreignSources = viewData.foreignSources || {};
    var locked = isDateLocked();

    // Zähler nach Haus → Einheit sortieren
    var sorted = viewData.meters.slice().sort(function (a, b) {
        var cmp = (a.haus || '').localeCompare(b.haus || '', 'de');
        if (cmp !== 0) return cmp;
        cmp = (a.einheit || '').localeCompare(b.einheit || '', 'de');
        if (cmp !== 0) return cmp;
        return (a.bezeichnung || '').localeCompare(b.bezeichnung || '', 'de');
    });

    // Anzahl sichtbarer Spalten für mobile colspan (Bezeichnung + Nr + M/A + Aktuell)
    // Haus/Einheit/Typ-Spalten sind auf Desktop sichtbar, auf Mobile hidden via CSS
    var colCount = 2 + (showMA ? 1 : 0) + (showAktuell ? 1 : 0);

    var h = '';

    // Toolbar: Spalten-Toggle + Datum
    h += '<div class="tbar">';
    h += '<span class="chip' + (showMA ? ' sel' : '') + '" onclick="toggleCol(\'ma\')" title="Memory/Stichtag">M/A</span>';
    h += '<span class="chip' + (showAktuell ? ' sel' : '') + '" onclick="toggleCol(\'aktuell\')" title="Ablesewert/Alt-Wert">Aktuell</span>';
    h += '<span style="flex:1"></span>';
    h += '<input type="date" id="inp-datum" value="' + currentDatum + '" onchange="onDatumChange(this.value)">';
    h += '</div>';

    // Tabelle mit Gruppierung
    h += '<div style="overflow-x:auto"><table><thead><tr>';
    h += '<th class="col-desk">Haus</th>';
    h += '<th class="col-desk">Einheit</th>';
    h += '<th>Bezeichnung</th>';
    h += '<th>Nr.</th>';
    h += '<th class="col-desk">Typ</th>';
    h += '<th class="col-ma' + (showMA ? '' : ' col-hide') + '" title="Memory/Stichtag">M/A</th>';
    h += '<th class="col-ak' + (showAktuell ? '' : ' col-hide') + '" title="Ablesewert/Alt-Wert">Aktuell</th>';
    h += '</tr></thead><tbody>';

    var lastHaus = null;
    var lastEinheit = null;
    sorted.forEach(function (m) {
        // Haus-Gruppenheader
        if (m.haus !== lastHaus) {
            h += '<tr class="grp-haus"><td colspan="' + colCount + '">' + esc(m.haus || 'Ohne Haus') + '</td></tr>';
            lastHaus = m.haus;
            lastEinheit = null; // Einheit zurücksetzen bei neuem Haus
        }
        // Einheit-Gruppenheader
        if (m.einheit !== lastEinheit) {
            h += '<tr class="grp-einheit"><td colspan="' + colCount + '">' + esc(m.einheit || 'Ohne Einheit') + '</td></tr>';
            lastEinheit = m.einheit;
        }
        // Zähler-Zeile
        var ex = existing[m.nr] || {};
        var isForeign = !!foreignSources[m.nr];
        var foreignHint = isForeign ? ' title="Wert von: ' + esc(foreignSources[m.nr]) + '"' : '';
        var foreignCls = isForeign ? ' foreign' : '';
        h += '<tr>';
        h += '<td class="col-desk">' + esc(m.haus) + '</td>';
        h += '<td class="col-desk">' + esc(m.einheit) + '</td>';
        h += '<td>' + esc(m.bezeichnung) + '<br><span class="col-typ-br">' + esc(m.typ) + '</span></td>';
        h += '<td class="col-nr">' + esc(m.nr) + '</td>';
        h += '<td class="col-desk">' + esc(m.typ) + '</td>';
        var dis = locked ? ' disabled' : '';
        var foreignLabel = isForeign ? '<span class="foreign-hint">von ' + esc(foreignSources[m.nr]) + '</span>' : '';
        h += '<td class="col-ma' + (showMA ? '' : ' col-hide') + '"><input class="vi' + foreignCls + '" type="text" inputmode="decimal" data-nr="' + esc(m.nr) + '" data-field="ma" value="' + esc(ex.wertMA || '') + '" oninput="onVal(this)"' + dis + foreignHint + '>' + (isForeign && (ex.wertMA || '') ? foreignLabel : '') + '</td>';
        h += '<td class="col-ak' + (showAktuell ? '' : ' col-hide') + '"><input class="vi' + foreignCls + '" type="text" inputmode="decimal" data-nr="' + esc(m.nr) + '" data-field="ak" value="' + esc(ex.wertAktuell || '') + '" oninput="onVal(this)"' + dis + foreignHint + '>' + (isForeign && (ex.wertAktuell || '') ? foreignLabel : '') + '</td>';
        h += '</tr>';
    });
    h += '</tbody></table></div>';
    if (locked) {
        var efDate = formatDateDE(viewData.view.editableFrom);
        h += '<div class="save-bar" style="text-align:center;color:#c62828;padding:8px 12px">Änderungen vor dem ' + esc(efDate) + ' sind gesperrt.</div>';
    } else {
        h += '<div class="save-bar" style="text-align:left;max-width:400px;margin:10px auto">';
        h += '<label for="notizen" style="display:block;font-weight:bold;margin-bottom:4px">Notizen (optional)</label>';
        h += '<textarea id="notizen" placeholder="Hier können Besonderheiten notiert werden..." style="width:100%;height:60px;margin-bottom:8px;padding:8px;border:1px solid #ccc;border-radius:4px;font:inherit">' + esc(viewData.notizen || '') + '</textarea><br>';
        h += '<button class="save-btn" id="btn-save" onclick="doSave()">Speichern</button>';
        h += '</div>';
    }

    document.getElementById('app').innerHTML = h;

    // Filled-Status setzen
    document.querySelectorAll('.vi').forEach(function (inp) {
        if (inp.value.trim()) inp.classList.add('filled');
    });
}

function toggleCol(col) {
    if (col === 'ma') showMA = !showMA;
    if (col === 'aktuell') showAktuell = !showAktuell;
    syncColsToUrl();
    render();
}

function syncColsToUrl() {
    var params = new URLSearchParams(window.location.search);
    var cols = [];
    if (showMA) cols.push('ma');
    if (showAktuell) cols.push('aktuell');
    if (cols.length) params.set('cols', cols.join(','));
    else params.set('cols', 'none');
    history.replaceState(null, '', window.location.pathname + '?' + params.toString());
}

async function onDatumChange(val) {
    currentDatum = val;
    // Datum in URL speichern
    syncDatumToUrl();
    // Daten für neues Datum nachladen
    var name = new URLSearchParams(window.location.search).get('name');
    try {
        var res = await fetch(API + '?action=load&name=' + encodeURIComponent(name) + '&datum=' + encodeURIComponent(val));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        viewData.existing = data.existing || {};
        viewData.notizen = data.notizen || '';
        viewData.foreignSources = data.foreignSources || {};
        viewData.datum = val;
        render();
    } catch (e) {
        toast('Fehler beim Laden: ' + e.message, 'err');
    }
}

function syncDatumToUrl() {
    var params = new URLSearchParams(window.location.search);
    var heute = new Date().toISOString().slice(0, 10);
    if (currentDatum && currentDatum !== heute) {
        params.set('datum', currentDatum);
    } else {
        params.delete('datum');
    }
    history.replaceState(null, '', window.location.pathname + '?' + params.toString());
}

function removeDatumFromUrl() {
    var params = new URLSearchParams(window.location.search);
    params.delete('datum');
    history.replaceState(null, '', window.location.pathname + '?' + params.toString());
}

function formatDateDE(iso) {
    var p = iso.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
}

function onVal(el) { el.classList.toggle('filled', el.value.trim() !== ''); }

async function doSave() {
    if (isDateLocked()) {
        toast('Änderungen für dieses Datum sind gesperrt.', 'err');
        return;
    }
    var existing = viewData.existing || {};
    var entries = [];
    viewData.meters.forEach(function (m) {
        var maInp = document.querySelector('input[data-nr="' + m.nr + '"][data-field="ma"]');
        var akInp = document.querySelector('input[data-nr="' + m.nr + '"][data-field="ak"]');
        var wMA = maInp ? maInp.value.trim() : '';
        var wAk = akInp ? akInp.value.trim() : '';
        var hadValues = existing[m.nr] && (existing[m.nr].wertMA || existing[m.nr].wertAktuell);
        // Senden wenn Werte vorhanden ODER wenn vorher Werte da waren (um Löschung zu ermöglichen)
        if (wMA || wAk || hadValues) {
            entries.push({ meterId: m.nr, wertMA: wMA, wertAktuell: wAk });
        }
    });
    if (!entries.length) { toast('Mindestens einen Wert eingeben.', 'warn'); return; }

    var btn = document.getElementById('btn-save');
    var notesText = document.getElementById('notizen') ? document.getElementById('notizen').value.trim() : '';
    btn.disabled = true; btn.textContent = 'Speichere…';
    try {
        var res = await fetch(API + '?action=save', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ datum: currentDatum, viewName: viewData.view.name, entries: entries, notizen: notesText }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var result = await res.json();
        // Lokalen state aktualisieren damit Export sofort stimmt
        if (!viewData.existing) viewData.existing = {};
        viewData.notizen = notesText;
        entries.forEach(function (e) {
            if (!viewData.existing[e.meterId]) viewData.existing[e.meterId] = {};
            viewData.existing[e.meterId].wertMA = e.wertMA;
            viewData.existing[e.meterId].wertAktuell = e.wertAktuell;
        });
        toast('✓ ' + (result.saved || 0) + ' Wert(e) gespeichert!', 'ok');
        btn.disabled = false; btn.textContent = 'Speichern';
    } catch (e) {
        toast('Fehler: ' + e.message, 'err');
        btn.disabled = false; btn.textContent = 'Speichern';
    }
}

// ── Burger-Menü ─────────────────────────────────────────────

function initBurgerMenu() {
    document.getElementById('btn-burger').addEventListener('click', function () {
        var vname = new URLSearchParams(window.location.search).get('name');
        var helpUrl = 'help.html';
        var chartUrl = 'chart.html';
        if (vname) {
            helpUrl += '?name=' + encodeURIComponent(vname);
            chartUrl += '?name=' + encodeURIComponent(vname);
        }
        HPExport.createExportMenu(document.getElementById('burger-wrap'), [
            { label: 'Excel exportieren', icon: '📊', onClick: exportReadingsExcel },
            { label: 'PDF exportieren', icon: '📕', onClick: exportReadingsPDF },
            { separator: true },
            { label: 'Excel importieren', icon: '📥', onClick: importReadingsExcel },
            { separator: true },
            { label: 'Hilfe', icon: '?', onClick: function () { window.location.href = helpUrl; } },
        ]);
    });
}

function getReadingsForExport() {
    if (!viewData || !viewData.meters) return { meters: [], existing: {} };
    var existing = viewData.existing || {};
    var sorted = viewData.meters.slice().sort(function (a, b) {
        var cmp = (a.haus || '').localeCompare(b.haus || '', 'de');
        if (cmp !== 0) return cmp;
        cmp = (a.einheit || '').localeCompare(b.einheit || '', 'de');
        if (cmp !== 0) return cmp;
        return (a.bezeichnung || '').localeCompare(b.bezeichnung || '', 'de');
    });
    return { meters: sorted, existing: viewData.existing || {} };
}

// Anzahl Ablesungs-Spalten für wiederverwendbare Formulare
var NUM_READING_COLS = 4;


function exportReadingsExcel() {
    var data = getReadingsForExport();
    var header = ['Haus', 'Einheit', 'Nr', 'Bezeichnung', 'Typ', 'Stichtag', 'Datum'];
    if (showMA) header.push('M/A');
    if (showAktuell) header.push('Aktuell');
    var rows = [header];
    data.meters.forEach(function (m) {
        var ex = data.existing[m.nr] || {};
        var row = [m.haus, m.einheit, m.nr, m.bezeichnung, m.typ, m.stichtag || '31.12', formatDateDE(currentDatum)];
        if (showMA) row.push(ex.wertMA || '');
        if (showAktuell) row.push(ex.wertAktuell || '');
        rows.push(row);
    });
    HPExport.exportExcel(rows, 'ablesung_' + viewData.view.name + '_' + currentDatum + '.xlsx', 'Ablesung');
    toast('Excel exportiert.', 'ok');
}

function exportReadingsPDF() {
    var data = getReadingsForExport();

    // Stichtage sammeln
    var stichtage = [];
    data.meters.forEach(function (m) {
        var s = m.stichtag || '31.12';
        if (stichtage.indexOf(s) === -1) stichtage.push(s);
    });
    stichtage.sort();

    // PDF: Einheit, Nr, Bezeichnung, Typ, M/A, Aktuell
    var head = ['Einheit', 'Nr.', 'Bezeichnung', 'Typ'];
    if (showMA) {
        var maLabel = 'M/A';
        if (stichtage.length > 0) maLabel += ' (' + stichtage.join(', ') + ')';
        head.push(maLabel);
    }
    if (showAktuell) head.push('Aktuell');

    var body = [];
    var lastHaus = null;
    var numMAColumns = (showMA ? 1 : 0) + (showAktuell ? 1 : 0);

    data.meters.forEach(function (m) {
        if (m.haus !== lastHaus) {
            body.push([{ content: m.haus || 'Ohne Haus', colSpan: 4 + numMAColumns, styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }]);
            lastHaus = m.haus;
        }
        var ex = data.existing[m.nr] || {};
        var row = [m.einheit, m.nr, m.bezeichnung, m.typ];
        if (showMA) row.push(ex.wertMA || '');
        if (showAktuell) row.push(ex.wertAktuell || '');
        body.push(row);
    });

    HPExport.exportPDF({
        title: 'Ablesung – ' + viewData.view.name,
        subtitle: data.meters.length + ' Zähler',
        head: head,
        body: body,
        filename: 'ablesung_' + viewData.view.name + '_' + currentDatum + '.pdf',
        orientation: 'landscape',
        afterDraw: function (doc, finalY, pageW) {
            var y = finalY + 10;
            if (y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 20; }

            doc.setFont(undefined, 'bold');
            doc.setFontSize(10);
            doc.text('Bestätigung', 10, y);
            doc.setFont(undefined, 'normal');
            doc.setFontSize(9);
            y += 6;

            var hasData = Object.keys(data.existing).length > 0;
            var datumStr = hasData ? formatDateDE(currentDatum) : '...................................';
            doc.text('Die Zählerstände wurden abgelesen am: ' + datumStr + ' durch: .................................................', 10, y);
            y += 6;
            doc.text('Die Richtigkeit wurde bestätigt durch (Nutzer): ................................................................................', 10, y);

            y += 10;
            doc.setFont(undefined, 'bold');
            doc.text('Notizen', 10, y);
            doc.setFont(undefined, 'normal');
            y += 6;

            var userNotes = (document.getElementById('notizen') ? document.getElementById('notizen').value : (viewData.notizen || '')).trim();
            if (userNotes) {
                var splitNotes = doc.splitTextToSize(userNotes, pageW - 20);
                doc.text(splitNotes, 10, y);
                y += splitNotes.length * 4 + 2;
            }

            doc.setDrawColor(220);
            for (var i = 0; i < 3; i++) {
                doc.line(10, y, pageW - 10, y);
                y += 6;
            }
        }
    });
    toast('PDF exportiert.', 'ok');
}


function importReadingsExcel() {
    HPExport.promptFileUpload('.xlsx,.xls', async function (file) {
        try {
            var buf = await HPExport.readFileAsArrayBuffer(file);
            var rows = HPExport.parseExcel(buf);
            await importReadingsFromFile(rows);
        } catch (e) {
            toast('Fehler: ' + e.message, 'err');
        }
    });
}

async function importReadingsFromFile(rows) {
    if (!rows.length) { toast('Keine Daten gefunden.', 'warn'); return; }
    // Mapping: flexible Spaltennamen
    var mapping = {
        'nr': 'nr', 'nr.': 'nr', 'zählernr': 'nr', 'zaehlernr': 'nr', 'meterid': 'nr',
        'wertma': 'wertMA', 'm/a': 'wertMA', 'ma': 'wertMA',
        'wertaktuell': 'wertAktuell', 'aktuell': 'wertAktuell',
        'datum': 'datum', 'date': 'datum',
    };
    var mapped = rows.map(function (r) {
        var m = {};
        Object.keys(r).forEach(function (k) {
            var mk = mapping[k.toLowerCase().trim()];
            if (mk) m[mk] = String(r[k]);
        });
        return m;
    }).filter(function (m) { return m.nr; });

    if (!mapped.length) { toast('Keine gültigen Daten. Spalte "Nr" benötigt.', 'warn'); return; }

    // Datum aus der Datei ermitteln (erstes gefundenes Datum)
    var importDatum = '';
    for (var i = 0; i < mapped.length; i++) {
        if (mapped[i].datum) { importDatum = mapped[i].datum; break; }
    }
    var datumInfo = importDatum ? formatDateDE(importDatum) : formatDateDE(currentDatum);
    if (!confirm(mapped.length + ' Werte für den ' + datumInfo + ' importieren?')) return;

    // Wenn Datum aus Datei abweicht, Datum-Feld anpassen
    if (importDatum && importDatum !== currentDatum) {
        var datumInp = document.getElementById('inp-datum');
        if (datumInp) {
            datumInp.value = importDatum;
            onDatumChange(importDatum);
        }
    }

    // Werte in die aktuellen Eingabefelder übernehmen
    var count = 0;
    mapped.forEach(function (m) {
        var maInp = document.querySelector('input[data-nr="' + m.nr + '"][data-field="ma"]');
        var akInp = document.querySelector('input[data-nr="' + m.nr + '"][data-field="ak"]');
        if (maInp && m.wertMA) { maInp.value = m.wertMA; maInp.classList.toggle('filled', true); count++; }
        if (akInp && m.wertAktuell) { akInp.value = m.wertAktuell; akInp.classList.toggle('filled', true); }
    });
    toast(count + ' Werte übernommen. Bitte prüfen und speichern.', 'ok');
}

function toast(msg, type) {
    var c = document.getElementById('hp-toast');
    var colors = { ok: '#2e7d32', err: '#c62828', warn: '#f57f17', info: '#1565c0' };
    var t = document.createElement('div');
    t.className = 'tmsg';
    t.style.background = colors[type] || colors.info;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(function () { t.remove(); }, 2500);
}
