/**
 * Hauspunkt – Readings (Mieter-Interface)
 * Zähler werden über "nr" identifiziert.
 * Pro Zähler+Tag: wertMA und wertAktuell.
 * Tagesweise upsert — gleicher Tag überschreibt.
 */

var API = 'api.php';
var viewData = null;
var showMA = true;
var showAktuell = true;
var currentDatum = '';
var sortColReadings = 'haus';
var sortAscReadings = true;

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
        if (cols !== null && cols !== 'none') {
            var colList = cols.split(',').filter(Boolean);
            showMA = colList.indexOf('ma') !== -1;
            showAktuell = colList.indexOf('aktuell') !== -1;
        } else {
            // cols=none oder kein cols: wenn bereits Werte da, Spalten anzeigen; sonst Buttons
            var ex = viewData.existing || {};
            var hasMA = Object.values(ex).some(function (e) { return (e.wertMA || '').trim() !== ''; });
            var hasAk = Object.values(ex).some(function (e) { return (e.wertAktuell || '').trim() !== ''; });
            if (hasMA || hasAk) {
                showMA = hasMA;
                showAktuell = hasAk;
            } else {
                showMA = true;
                showAktuell = true;
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
                    if (data2.readingDates) viewData.readingDates = data2.readingDates;
                    if (urlParams.get('cols') === null || urlParams.get('cols') === 'none') {
                        var ex = viewData.existing || {};
                        var hasMA = Object.values(ex).some(function (e) { return (e.wertMA || '').trim() !== ''; });
                        var hasAk = Object.values(ex).some(function (e) { return (e.wertAktuell || '').trim() !== ''; });
                        if (hasMA || hasAk) { showMA = hasMA; showAktuell = hasAk; }
                    }
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
        initReadingsSort();
        render();
    } catch (e) {
        document.getElementById('app').innerHTML = '<div class="hp-err">Ungültiger Link.<br><small style="color:#999">' + esc(e.message) + '</small></div>';
    }
}

function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function isDateLocked() {
    var from = viewData.view.editableFrom || '';
    var until = viewData.view.editableUntil || '';
    if (from && currentDatum < from) return true;
    if (until && currentDatum > until) return true;
    return false;
}

function render() {
    document.getElementById('hdr-title').textContent = viewData.view.name;
    var existing = viewData.existing || {};
    var foreignSources = viewData.foreignSources || {};
    var locked = isDateLocked();

    // Zähler nach gewählter Spalte sortieren (M/A und Aktuell: leere Felder = -1)
    var sorted = viewData.meters.slice().sort(function (a, b) {
        var col = sortColReadings || 'haus';
        var va, vb;
        if (col === 'ma' || col === 'aktuell') {
            var key = col === 'ma' ? 'wertMA' : 'wertAktuell';
            var exA = existing[a.nr] || {};
            var exB = existing[b.nr] || {};
            var strA = (exA[key] || '').trim();
            var strB = (exB[key] || '').trim();
            va = strA === '' ? -1 : (parseFloat(strA) || strA);
            vb = strB === '' ? -1 : (parseFloat(strB) || strB);
            var cmp;
            if (typeof va === 'number' && typeof vb === 'number') {
                cmp = va < vb ? -1 : (va > vb ? 1 : 0);
            } else {
                cmp = String(va).localeCompare(String(vb), 'de', { sensitivity: 'base' });
            }
            return sortAscReadings ? cmp : -cmp;
        }
        va = a[col] || '';
        vb = b[col] || '';
        var cmp = String(va).localeCompare(String(vb), 'de', { sensitivity: 'base' });
        return sortAscReadings ? cmp : -cmp;
    });

    // Anzahl sichtbarer Spalten für mobile colspan
    var needsChoice = !showMA && !showAktuell;
    var colCount = 2 + (needsChoice ? 1 : 0) + (showMA ? 1 : 0) + (showAktuell ? 1 : 0);

    var h = '';

    // Toolbar: Spalten-Toggle + PDF + Datum
    h += '<div class="tbar">';
    h += '<span class="chip' + (showMA ? ' sel' : '') + '" onclick="toggleCol(\'ma\')" title="Memory/Stichtag">M/A</span>';
    h += '<span class="chip' + (showAktuell ? ' sel' : '') + '" onclick="toggleCol(\'aktuell\')" title="Ablesewert/Alt-Wert">Aktuell</span>';

    // Hilfe-Link im Header aktualisieren
    var vname = new URLSearchParams(window.location.search).get('name');
    var helpUrl = 'help.html' + (vname ? '?name=' + encodeURIComponent(vname) : '');
    var helpBtn = document.getElementById('btn-help');
    if (helpBtn) helpBtn.href = helpUrl;

    if (viewData.readingId && viewData.pdf) {
        h += '<a href="' + esc(viewData.pdf) + '" target="_blank" class="chip" style="background:#e8f5e9;border-color:#4caf50;color:#2e7d32;text-decoration:none" title="Unterschriebenes PDF herunterladen">✓ PDF</a>';
    }

    h += '<span style="flex:1"></span>';
    h += '<input type="date" id="inp-datum" value="' + currentDatum + '" onchange="onDatumChange(this.value)">';
    h += '</div>';

    // Tabelle mit Gruppierung (sortierbare Spalten)
    h += '<div style="overflow-x:auto"><table><thead><tr id="readings-head">';
    h += '<th class="col-desk" data-sort="haus">Haus</th>';
    h += '<th class="col-desk" data-sort="einheit">Einheit</th>';
    h += '<th data-sort="bezeichnung">Bezeichnung</th>';
    h += '<th class="col-desk" data-sort="typ">Typ</th>';
    h += '<th data-sort="nr">Nr.</th>';
    if (needsChoice) {
        h += '<th class="col-choice">';
        h += '<span class="col-choice-lbl">Spalte wählen:</span> ';
        h += '<button type="button" class="col-choice-btn" onclick="chooseCol(\'ma\')" title="Memory/Stichtag">M/A</button> ';
        h += '<button type="button" class="col-choice-btn" onclick="chooseCol(\'aktuell\')" title="Ablesewert/Alt-Wert">Aktuell</button>';
        h += '</th>';
    } else {
        h += '<th class="col-ma' + (showMA ? '' : ' col-hide') + '" data-sort="ma" title="Memory/Stichtag">M/A</th>';
        h += '<th class="col-ak' + (showAktuell ? '' : ' col-hide') + '" data-sort="aktuell" title="Ablesewert/Alt-Wert">Aktuell</th>';
    }
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
        h += '<td class="col-desk">' + esc(m.typ) + '</td>';
        h += '<td class="col-nr">' + esc(m.nr) + '</td>';
        var dis = locked ? ' disabled' : '';
        var foreignLabel = isForeign ? '<span class="foreign-hint">von ' + esc(foreignSources[m.nr]) + '</span>' : '';
        if (needsChoice) {
            h += '<td class="col-choice"></td>';
        } else {
            h += '<td class="col-ma' + (showMA ? '' : ' col-hide') + '"><input class="vi' + foreignCls + '" type="text" inputmode="decimal" data-nr="' + esc(m.nr) + '" data-field="ma" value="' + esc(ex.wertMA || '') + '" oninput="onVal(this)"' + dis + foreignHint + '>' + (isForeign && (ex.wertMA || '') ? foreignLabel : '') + '</td>';
            h += '<td class="col-ak' + (showAktuell ? '' : ' col-hide') + '"><input class="vi' + foreignCls + '" type="text" inputmode="decimal" data-nr="' + esc(m.nr) + '" data-field="ak" value="' + esc(ex.wertAktuell || '') + '" oninput="onVal(this)"' + dis + foreignHint + '>' + (isForeign && (ex.wertAktuell || '') ? foreignLabel : '') + '</td>';
        }
        h += '</tr>';
    });
    h += '</tbody></table></div>';


    var rDates = viewData.readingDates || [];
    if (rDates.length) {
        h += '<div class="reading-dates-hint">Ihre Ablesungen: ';
        h += rDates.map(function (d) {
            var label = formatDateDE(d);
            return '<a href="#" onclick="onDatumChange(\'' + esc(d) + '\');return false" title="' + esc(label) + '">' + esc(label) + '</a>';
        }).join(' ');
        h += '</div>';
    }

    if (locked) {
        var from = viewData.view.editableFrom || '';
        var until = viewData.view.editableUntil || '';
        var msg = 'Gesperrt: Änderungen sind ';
        if (from && until) msg += 'nur vom ' + formatDateDE(from) + ' bis ' + formatDateDE(until) + ' erlaubt.';
        else if (from) msg += 'erst ab dem ' + formatDateDE(from) + ' erlaubt.';
        else if (until) msg += 'nur bis zum ' + formatDateDE(until) + ' erlaubt.';
        h += '<div class="save-bar" style="text-align:center;color:#c62828;padding:8px 12px">' + esc(msg) + '</div>';
    } else {
        h += '<div class="save-bar">';
        h += '<textarea id="notizen" placeholder="Notizen (optional)" style="flex:1;padding:8px;border:1px solid #ccc;border-radius:4px;font:inherit;resize:none">' + esc(viewData.notizen || '') + '</textarea>';
        h += '<button class="save-btn" id="btn-save" onclick="doSave()">Speichern</button>';
        h += '</div>';
    }

    document.getElementById('app').innerHTML = h;

    // Filled-Status setzen
    document.querySelectorAll('.vi').forEach(function (inp) {
        if (inp.value.trim()) inp.classList.add('filled');
    });
}

function initReadingsSort() {
    document.getElementById('app').addEventListener('click', function (e) {
        var th = e.target.closest('th[data-sort]');
        if (!th || !viewData) return;
        var col = th.dataset.sort;
        if (sortColReadings === col) sortAscReadings = !sortAscReadings;
        else { sortColReadings = col; sortAscReadings = true; }
        // Aktuelle Eingabewerte vor Re-Render sichern (für Sortierung nach M/A oder Aktuell)
        if (col === 'ma' || col === 'aktuell') {
            if (!viewData.existing) viewData.existing = {};
            document.querySelectorAll('input[data-nr][data-field]').forEach(function (inp) {
                var nr = inp.dataset.nr;
                var f = inp.dataset.field;
                var v = (inp.value || '').trim();
                if (!viewData.existing[nr]) viewData.existing[nr] = {};
                viewData.existing[nr][f === 'ma' ? 'wertMA' : 'wertAktuell'] = v;
            });
        }
        render();
    });
}

function chooseCol(col) {
    if (col === 'ma') { showMA = true; showAktuell = false; }
    if (col === 'aktuell') { showMA = false; showAktuell = true; }
    syncColsToUrl();
    render();
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
    syncDatumToUrl();
    var name = new URLSearchParams(window.location.search).get('name');
    var urlParams = new URLSearchParams(window.location.search);
    try {
        var res = await fetch(API + '?action=load&name=' + encodeURIComponent(name) + '&datum=' + encodeURIComponent(val));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        viewData.existing = data.existing || {};
        viewData.notizen = data.notizen || '';
        viewData.readingId = data.readingId || '';
        viewData.pdf = data.pdf || '';
        viewData.foreignSources = data.foreignSources || {};
        if (data.readingDates) viewData.readingDates = data.readingDates;
        viewData.datum = val;
        if (urlParams.get('cols') === null || urlParams.get('cols') === 'none') {
            var ex = viewData.existing || {};
            var hasMA = Object.values(ex).some(function (e) { return (e.wertMA || '').trim() !== ''; });
            var hasAk = Object.values(ex).some(function (e) { return (e.wertAktuell || '').trim() !== ''; });
            if (hasMA || hasAk) {
                showMA = hasMA;
                showAktuell = hasAk;
            } else {
                showMA = true;
                showAktuell = true;
            }
        }
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
        viewData.readingId = result.id || viewData.readingId;

        entries.forEach(function (e) {
            if (!viewData.existing[e.meterId]) viewData.existing[e.meterId] = {};
            viewData.existing[e.meterId].wertMA = e.wertMA;
            viewData.existing[e.meterId].wertAktuell = e.wertAktuell;
        });
        if (entries.length && (!viewData.readingDates || viewData.readingDates.indexOf(currentDatum) === -1)) {
            viewData.readingDates = (viewData.readingDates || []).concat(currentDatum).sort();
        }
        toast('✓ ' + (result.saved || 0) + ' Wert(e) gespeichert!', 'ok');
        btn.disabled = false; btn.textContent = 'Speichern';
        render(); // Erneutes Rendern um Upload-Button anzuzeigen
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
            { label: 'Excel importieren', icon: '📥', onClick: importReadingsExcel },
            { separator: true },
            { label: 'PDF exportieren', icon: '📕', onClick: exportReadingsPDF },
            { label: 'Unterschriebenes PDF hochladen', icon: '📤', onClick: doUploadPDF },
        ]);
    });
}

function doUploadPDF() {
    if (!viewData.readingId) {
        toast('Bitte zuerst die Zählerstände speichern.', 'warn');
        return;
    }
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.pdf';
    inp.onchange = async function () {
        if (!inp.files.length) return;
        var file = inp.files[0];
        var fd = new FormData();
        fd.append('readingId', viewData.readingId);
        fd.append('pdf', file);

        try {
            toast('Lade PDF hoch...', 'wait');
            var res = await fetch(API + '?action=upload_pdf', {
                method: 'POST',
                body: fd
            });
            if (!res.ok) throw new Error('Upload fehlgeschlagen');
            var result = await res.json();
            viewData.pdf = result.pdf;
            render();
            toast('✓ PDF hochgeladen.', 'ok');
        } catch (e) {
            toast('Fehler: ' + e.message, 'err');
        }
    };
    inp.click();
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
    var header = ['Haus', 'Einheit', 'Bezeichnung', 'Typ', 'Nr', 'Stichtag', 'Datum'];
    if (showMA) header.push('M/A');
    if (showAktuell) header.push('Aktuell');
    var rows = [header];
    data.meters.forEach(function (m) {
        var ex = data.existing[m.nr] || {};
        var row = [m.haus, m.einheit, m.bezeichnung, m.typ, m.nr, m.stichtag || '31.12', formatDateDE(currentDatum)];
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

    // PDF: Einheit, Bezeichnung, Typ, Nr., M/A, Aktuell
    var head = ['Einheit', 'Bezeichnung', 'Typ', 'Nr.'];
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
        var row = [m.einheit, m.bezeichnung, m.typ, m.nr];
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
