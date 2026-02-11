/**
 * Hauspunkt – Admin Frontend
 * Super kompakt, alles inline, keine Dialoge.
 * Zähler werden über "nr" identifiziert (kein internes id-Feld).
 */

const API = 'api.php';
let meters = [];
let views = [];
let readings = [];
let sortCol = '';
let sortAsc = true;
let sortColView = '';
let sortAscView = true;
let sortColOv = 'haus';
let sortAscOv = true;

const FIELDS = ['haus', 'einheit', 'bezeichnung', 'nr', 'typ', 'faktor', 'stichtag', 'aktiv'];
const FIELDS_INTERNAL = ['haus', 'einheit', 'bezeichnung', 'nr', 'typ', 'faktor', 'stichtag', 'validFrom', 'validTo'];
let dirtyRows = {};    // { nr: { field: newValue, ... } }
let origNrMap = {};    // { nr: origNr } — tracks if nr itself was changed
let newRows = [];      // [ { tempId, nr, bezeichnung, ... } ]
let deletedNrs = [];   // [ nr, ... ]

// Ansichten: welche Zeile ist gerade im Edit-Modus?
let editingViewId = null; // null = keine, 'NEW' = neue Ansicht

// Zähler: Edit-Modus (false = readonly, true = bearbeitbar)
let editMode = false;
let forceDateUI = new Set(); // Stores nr or tempId

// ── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initMeterEvents();
    initViewEvents();
    initOverviewEvents();
    initGlobalMenu();
    loadAll();
});

function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            switchTab(tab.dataset.tab);
        });
    });
}

async function loadAll() {
    try {
        [meters, views, readings] = await Promise.all([
            HP.api(API + '?action=meters'),
            HP.api(API + '?action=views'),
            HP.api(API + '?action=readings'),
        ]);
        refreshFilters();
        loadFiltersFromUrl();
        // Edit-Modus aus URL laden
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('edit') === '1') {
            editMode = true;
            document.body.classList.add('editing');
        }
        // Tab aus URL laden
        const urlTab = urlParams.get('tab');
        if (urlTab && document.querySelector('.tab[data-tab="' + urlTab + '"]')) {
            switchTab(urlTab);
        }
        renderMeters();
        renderViews();
    } catch (e) {
        toast('Fehler: ' + e.message, 'err');
    }
}

// ── Filters ──────────────────────────────────────────────────

// ── Custom Multi-Select Component ───────────────────────────

const mselInstances = {}; // id -> { el, options, selected, onChange }

function mselInit(id, onChange) {
    const el = document.getElementById(id);
    const inst = { el, options: [], selected: [], onChange };
    mselInstances[id] = inst;
    el.innerHTML = '';

    const box = document.createElement('div');
    box.className = 'msel-box';
    const ph = document.createElement('span');
    ph.className = 'msel-ph';
    ph.textContent = 'Alle';
    box.appendChild(ph);
    const arrow = document.createElement('span');
    arrow.className = 'msel-arrow';
    arrow.textContent = '▾';
    box.appendChild(arrow);

    const dd = document.createElement('div');
    dd.className = 'msel-dd';

    el.appendChild(box);
    el.appendChild(dd);

    box.addEventListener('click', (e) => {
        // Don't toggle if clicking the X on a chip
        if (e.target.classList.contains('msel-x')) return;
        // Close all other dropdowns
        Object.values(mselInstances).forEach(other => {
            if (other !== inst) other.el.querySelector('.msel-dd').classList.remove('open');
        });
        dd.classList.toggle('open');
        e.stopPropagation();
    });

    return inst;
}

function mselSetOptions(id, opts) {
    const inst = mselInstances[id];
    if (!inst) return;
    inst.options = opts;
    // Keep only selections that still exist
    inst.selected = inst.selected.filter(s => opts.includes(s));
    mselRender(id);
}

function mselGetVals(id) {
    const inst = mselInstances[id];
    return inst ? inst.selected.slice() : [];
}

function mselSetVals(id, vals) {
    const inst = mselInstances[id];
    if (!inst) return;
    inst.selected = vals.filter(v => inst.options.includes(v));
    mselRender(id);
}

function mselRender(id) {
    const inst = mselInstances[id];
    if (!inst) return;
    const box = inst.el.querySelector('.msel-box');
    const dd = inst.el.querySelector('.msel-dd');

    // Render box: chips for selected, or placeholder
    box.innerHTML = '';
    if (inst.selected.length === 0) {
        const ph = document.createElement('span');
        ph.className = 'msel-ph';
        ph.textContent = 'Alle';
        box.appendChild(ph);
    } else {
        inst.selected.forEach(val => {
            const chip = document.createElement('span');
            chip.className = 'msel-chip';
            chip.textContent = val;
            const x = document.createElement('span');
            x.className = 'msel-x';
            x.textContent = '✕';
            x.addEventListener('click', (e) => {
                e.stopPropagation();
                inst.selected = inst.selected.filter(s => s !== val);
                mselRender(id);
                if (inst.onChange) inst.onChange();
            });
            chip.appendChild(x);
            box.appendChild(chip);
        });
    }
    const arrow = document.createElement('span');
    arrow.className = 'msel-arrow';
    arrow.textContent = '▾';
    box.appendChild(arrow);

    // Render dropdown: checkboxes
    dd.innerHTML = '';
    inst.options.forEach(opt => {
        const lbl = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = inst.selected.includes(opt);
        cb.addEventListener('change', () => {
            if (cb.checked) {
                if (!inst.selected.includes(opt)) inst.selected.push(opt);
            } else {
                inst.selected = inst.selected.filter(s => s !== opt);
            }
            mselRender(id);
            if (inst.onChange) inst.onChange();
        });
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(opt));
        dd.appendChild(lbl);
    });
}

// Close all dropdowns when clicking outside
document.addEventListener('click', () => {
    Object.values(mselInstances).forEach(inst => {
        inst.el.querySelector('.msel-dd').classList.remove('open');
    });
});

function refreshFilters() {
    const h = [...new Set(meters.map(m => m.haus).filter(Boolean))].sort();
    const e = [...new Set(meters.map(m => m.einheit).filter(Boolean))].sort();
    const t = [...new Set(meters.map(m => m.typ).filter(Boolean))].sort();
    fillSimpleSel('#f-haus', h); mselSetOptions('f-einheit', e); mselSetOptions('f-typ', t);
    fillSimpleSel('#of-haus', h); mselSetOptions('of-einheit', e); mselSetOptions('of-typ', t);
    mselSetOptions('of-werte', ['M/A', 'Aktuell', 'M/A Gesamt']);
}

function fillSimpleSel(sel, opts) {
    const el = document.querySelector(sel);
    const cur = el.value;
    el.innerHTML = '<option value="">Alle</option>';
    opts.forEach(o => { const op = document.createElement('option'); op.value = o; op.textContent = o; el.appendChild(op); });
    if (cur) el.value = cur;
}

/** Holt ausgewählte Werte als Array */
function getSelVals(el) {
    const id = el.id || '';
    if (mselInstances[id]) return mselGetVals(id);
    // Simple select: return value as array, empty string = no filter
    const val = el.value;
    return val ? [val] : [];
}

function getFiltered(haus, einheit, typ) {
    // haus, einheit, typ sind jetzt Arrays; leeres Array = kein Filter
    return meters.filter(m => {
        if (haus.length && !haus.includes(m.haus)) return false;
        if (einheit.length && !einheit.includes(m.einheit)) return false;
        if (typ.length && !typ.includes(m.typ)) return false;
        return true;
    });
}

function getFilteredByView(filter) {
    return meters.filter(m => {
        if (filter.haus && m.haus !== filter.haus) return false;
        if (filter.einheit && Array.isArray(filter.einheit) && filter.einheit.length > 0) {
            if (!filter.einheit.includes(m.einheit)) return false;
        }
        if (filter.typ && m.typ !== filter.typ) return false;
        return true;
    });
}

/** Menge der Zähler-IDs, die zur Ansicht viewName gehören (für Sanity-Check bei Readings) */
function getViewAllowedMeterIds(viewName) {
    const v = views.find(x => x.name === viewName);
    if (!v || !v.filter) return new Set(meters.map(m => m.nr)); // Fallback: alle
    return new Set(getFilteredByView(v.filter).map(m => m.nr));
}

// ── Zähler ───────────────────────────────────────────────────

function initMeterEvents() {
    document.getElementById('btn-add').addEventListener('click', () => { setEditMode(true); addNewRow(); });
    document.getElementById('btn-save').addEventListener('click', saveAllChanges);
    document.getElementById('btn-discard').addEventListener('click', discardAll);
    // Filters
    const meterFilterChange = () => { syncFiltersToUrl(); renderMeters(); };
    document.getElementById('f-haus').addEventListener('change', meterFilterChange);
    mselInit('f-einheit', meterFilterChange);
    mselInit('f-typ', meterFilterChange);

    document.getElementById('btn-delete-filtered').addEventListener('click', deleteFilteredMeters);
    document.getElementById('btn-import-csv').addEventListener('click', importMetersCSV);
    document.getElementById('btn-import-excel').addEventListener('click', importMetersExcel);
    document.getElementById('btn-import-ista').addEventListener('click', importISTACSV);

    document.getElementById('qv-name-placeholder')?.remove(); // Cleanup if exists
    document.getElementById('m-head').addEventListener('click', e => {
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        const col = th.dataset.sort;
        if (sortCol === col) sortAsc = !sortAsc;
        else { sortCol = col; sortAsc = true; }
        renderMeters();
    });
}

function setEditMode(on) {
    editMode = on;
    document.body.classList.toggle('editing', on);
    const pMeters = document.getElementById('p-meters');
    if (pMeters) pMeters.classList.toggle('editing', on);

    // URL param
    const params = new URLSearchParams(window.location.search);
    if (editMode) params.set('edit', '1'); else params.delete('edit');
    history.replaceState(null, '', window.location.pathname + '?' + params.toString());
    renderMeters();
}

// ── URL ↔ Filter Sync ──────────────────────────────────────

function syncFiltersToUrl() {
    const params = new URLSearchParams(window.location.search);
    // Lese aktiven Tab, um die richtigen Filter zu nehmen
    const activeTab = document.querySelector('.tab.act');
    const isOverview = activeTab && activeTab.dataset.tab === 'overview';
    const haus = getSelVals(document.getElementById(isOverview ? 'of-haus' : 'f-haus'));
    const einheit = getSelVals(document.getElementById(isOverview ? 'of-einheit' : 'f-einheit'));
    const typ = getSelVals(document.getElementById(isOverview ? 'of-typ' : 'f-typ'));
    if (haus.length) params.set('haus', haus.join('|')); else params.delete('haus');
    if (einheit.length) params.set('einheit', einheit.join('|')); else params.delete('einheit');
    if (typ.length) params.set('typ', typ.join('|')); else params.delete('typ');
    // Jahr-Filter
    const jahre = getSelectedYear();
    if (jahre.length) params.set('jahr', jahre.join('|')); else params.delete('jahr');
    // Werte-Filter
    const werte = getSelVals(document.getElementById('of-werte'));
    if (werte.length) params.set('werte', werte.join('|')); else params.delete('werte');
    params.delete('von'); params.delete('bis');
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? '?' + qs : '');
    history.replaceState(null, '', newUrl);
}

function loadFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const hausParam = params.get('haus');
    let haus = (hausParam !== null) ? hausParam.split('|').map(s => s.trim()).filter(Boolean) : [];
    if (hausParam === null) {
        const firstHaus = [...new Set(meters.map(m => m.haus).filter(Boolean))].sort()[0];
        if (firstHaus) haus = [firstHaus];
    }
    setSelVals(document.getElementById('f-haus'), haus);
    setSelVals(document.getElementById('f-einheit'), (params.get('einheit') || '').split('|').map(s => s.trim()).filter(Boolean));
    setSelVals(document.getElementById('f-typ'), (params.get('typ') || '').split('|').map(s => s.trim()).filter(Boolean));
    setSelVals(document.getElementById('of-haus'), haus);
    setSelVals(document.getElementById('of-einheit'), (params.get('einheit') || '').split('|').map(s => s.trim()).filter(Boolean));
    setSelVals(document.getElementById('of-typ'), (params.get('typ') || '').split('|').map(s => s.trim()).filter(Boolean));
    const werteParam = params.get('werte');
    const werte = (werteParam !== null) ? werteParam.split('|').map(s => s.trim()).filter(Boolean) : ['M/A', 'Aktuell'];
    setSelVals(document.getElementById('of-werte'), werte);
    const jahre = (params.get('jahr') || '').split('|').map(s => s.trim()).filter(Boolean);
    setSelVals(document.getElementById('of-jahr'), jahre);
    // Jahr-Filter (wird in refreshYearFilter via URL gesetzt)
}

function setSelVals(el, vals) {
    const id = el.id || '';
    if (mselInstances[id]) { mselSetVals(id, vals); return; }
    // Simple select: set first matching value only if it exists as option, else ""
    if (vals.length) {
        const opts = [...el.options].map(o => o.value);
        const match = opts.includes(vals[0]);
        el.value = match ? vals[0] : '';
    } else {
        el.value = '';
    }
}

function renderMeters() {
    const haus = getSelVals(document.getElementById('f-haus'));
    const einheit = getSelVals(document.getElementById('f-einheit'));
    const typ = getSelVals(document.getElementById('f-typ'));
    let list = getFiltered(haus, einheit, typ);

    if (sortCol) {
        list.sort((a, b) => {
            const cmp = (a[sortCol] || '').localeCompare(b[sortCol] || '', 'de', { sensitivity: 'base' });
            return sortAsc ? cmp : -cmp;
        });
    }

    const tbody = document.getElementById('m-body');
    tbody.innerHTML = '';

    list.forEach(m => {
        const nr = m.nr;
        const isDel = deletedNrs.includes(nr);
        const tr = document.createElement('tr');
        if (isDel) tr.className = 'del';
        FIELDS.forEach(f => {
            const td = document.createElement('td');

            if (f === 'aktiv') {
                if (editMode) {
                    const vFrom = (dirtyRows[nr] && dirtyRows[nr].validFrom !== undefined) ? dirtyRows[nr].validFrom : (m.validFrom || '');
                    const vTo = (dirtyRows[nr] && dirtyRows[nr].validTo !== undefined) ? dirtyRows[nr].validTo : (m.validTo || '');

                    if (!vFrom && !vTo && !forceDateUI.has(nr)) {
                        const wrap = document.createElement('div');
                        wrap.style.display = 'flex';
                        wrap.style.gap = '4px';

                        const bVB = mk('button', 'Von/Bis', 'b b-p');
                        bVB.onclick = () => { forceDateUI.add(nr); renderMeters(); };

                        const bIn = mk('button', 'Inaktiv', 'b b-d');
                        bIn.onclick = () => {
                            onEdit(nr, 'validFrom', '2000-01-01', m.validFrom || '');
                            onEdit(nr, 'validTo', '2000-01-01', m.validTo || '');
                            renderMeters();
                        };

                        wrap.appendChild(bVB);
                        wrap.appendChild(bIn);
                        td.appendChild(wrap);
                    } else {
                        const wrap = document.createElement('div');
                        wrap.style.display = 'flex';
                        wrap.style.flexDirection = 'column';
                        wrap.style.gap = '2px';

                        const createDateRow = (field, label) => {
                            const row = document.createElement('div');
                            row.style.display = 'flex';
                            row.style.gap = '2px';
                            row.style.alignItems = 'center';
                            row.style.fontSize = '11px';
                            row.innerHTML = `<span style="width:25px">${label}:</span>`;

                            const val = (dirtyRows[nr] && dirtyRows[nr][field] !== undefined) ? dirtyRows[nr][field] : (m[field] || '');
                            const inp = document.createElement('input');
                            inp.type = 'date';
                            inp.value = val;
                            inp.disabled = isDel;
                            inp.style.width = '110px';
                            inp.className = 'ii';
                            if (dirtyRows[nr] && dirtyRows[nr][field] !== undefined) inp.classList.add('dirty');
                            inp.addEventListener('change', () => onEdit(nr, field, inp.value, m[field] || ''));

                            const btnH = mk('button', 'H', 'b b-p');
                            btnH.title = 'Heute';
                            btnH.onclick = () => { inp.value = new Date().toISOString().slice(0, 10); onEdit(nr, field, inp.value, m[field] || ''); };
                            btnH.disabled = isDel;

                            const btnC = mk('button', '✕', 'b');
                            btnC.title = 'Leeren';
                            btnC.onclick = () => { inp.value = ''; onEdit(nr, field, inp.value, m[field] || ''); };
                            btnC.disabled = isDel;

                            row.appendChild(inp);
                            row.appendChild(btnH);
                            row.appendChild(btnC);
                            return row;
                        };

                        wrap.appendChild(createDateRow('validFrom', 'Von'));
                        wrap.appendChild(createDateRow('validTo', 'Bis'));
                        td.appendChild(wrap);
                    }
                } else {
                    const isActive = HP.isMeterActive(m);
                    td.textContent = isActive ? 'Ja' : 'Nein';
                    td.style.textAlign = 'center';
                    if (!isActive) td.style.color = '#c62828';
                }
            } else {
                const val = (dirtyRows[nr] && dirtyRows[nr][f] !== undefined) ? dirtyRows[nr][f] : (m[f] || (f === 'stichtag' ? '31.12' : ''));
                if (editMode) {
                    const inp = document.createElement('input');
                    inp.className = 'ii';
                    inp.value = val;
                    inp.dataset.mnr = nr;
                    inp.dataset.f = f;
                    if (f === 'stichtag') inp.placeholder = '31.12';
                    if (isDel) inp.disabled = true;
                    if (dirtyRows[nr] && dirtyRows[nr][f] !== undefined) inp.classList.add('dirty');
                    inp.addEventListener('input', () => onEdit(nr, f, inp.value, m[f]));
                    td.appendChild(inp);
                } else {
                    td.textContent = f === 'stichtag' ? (m[f] || '31.12') : (m[f] || '');
                }
            }
            tr.appendChild(td);
        });
        const tdA = document.createElement('td');
        tdA.className = 'edit-only';
        tdA.style.whiteSpace = 'nowrap';
        if (isDel) {
            const btn = mk('button', '↩', 'b b-p');
            btn.onclick = () => { deletedNrs = deletedNrs.filter(x => x !== nr); updateSaveBar(); renderMeters(); };
            tdA.appendChild(btn);
        } else {
            const btn = mk('button', '✕', 'b b-d');
            btn.onclick = () => { if (!deletedNrs.includes(nr)) deletedNrs.push(nr); updateSaveBar(); renderMeters(); };
            tdA.appendChild(btn);
        }
        tr.appendChild(tdA);
        tbody.appendChild(tr);
    });

    newRows.forEach((row, idx) => {
        const tr = document.createElement('tr');
        tr.className = 'new';
        FIELDS.forEach(f => {
            const td = document.createElement('td');
            if (f === 'aktiv') {
                if (!row.validFrom && !row.validTo && !forceDateUI.has(row.tempId)) {
                    const wrap = document.createElement('div');
                    wrap.style.display = 'flex';
                    wrap.style.gap = '4px';

                    const bVB = mk('button', 'Von/Bis', 'b b-p');
                    bVB.onclick = () => { forceDateUI.add(row.tempId); renderMeters(); };

                    const bIn = mk('button', 'Inaktiv', 'b b-d');
                    bIn.onclick = () => {
                        row.validFrom = '2000-01-01';
                        row.validTo = '2000-01-01';
                        renderMeters();
                    };

                    wrap.appendChild(bVB);
                    wrap.appendChild(bIn);
                    td.appendChild(wrap);
                } else {
                    const wrap = document.createElement('div');
                    wrap.style.display = 'flex';
                    wrap.style.flexDirection = 'column';
                    wrap.style.gap = '2px';

                    const createDateRow = (field, label) => {
                        const div = document.createElement('div');
                        div.style.display = 'flex';
                        div.style.gap = '2px';
                        div.style.alignItems = 'center';
                        div.style.fontSize = '11px';
                        div.innerHTML = `<span style="width:25px">${label}:</span>`;

                        const inp = document.createElement('input');
                        inp.type = 'date';
                        inp.value = row[field] || '';
                        inp.style.width = '110px';
                        inp.className = 'ii';
                        inp.addEventListener('change', () => { row[field] = inp.value; });

                        const btnH = mk('button', 'H', 'b b-p');
                        btnH.title = 'Heute';
                        btnH.onclick = () => { inp.value = new Date().toISOString().slice(0, 10); row[field] = inp.value; };

                        const btnC = mk('button', '✕', 'b');
                        btnC.title = 'Leeren';
                        btnC.onclick = () => { inp.value = ''; row[field] = ''; };

                        div.appendChild(inp);
                        div.appendChild(btnH);
                        div.appendChild(btnC);
                        return div;
                    };

                    wrap.appendChild(createDateRow('validFrom', 'Von'));
                    wrap.appendChild(createDateRow('validTo', 'Bis'));
                    td.appendChild(wrap);
                }
            } else {
                const inp = document.createElement('input');
                inp.className = 'ii';
                inp.value = row[f] || '';
                inp.placeholder = f;
                inp.addEventListener('input', () => { row[f] = inp.value; });
                td.appendChild(inp);
            }
            tr.appendChild(td);
        });
        const tdA = document.createElement('td');
        tdA.className = 'edit-only';
        const btn = mk('button', '✕', 'b b-d');
        btn.onclick = () => { newRows.splice(idx, 1); updateSaveBar(); renderMeters(); };
        tdA.appendChild(btn);
        tr.appendChild(tdA);
        tbody.appendChild(tr);
    });

    // Quick-View Info aktualisieren
    updateQuickViewInfo();
}

function onEdit(nr, f, val, orig) {
    if (val !== orig) {
        if (!dirtyRows[nr]) dirtyRows[nr] = {};
        dirtyRows[nr][f] = val;
        if (f === 'nr') {
            origNrMap[nr] = nr;
        }
    } else if (dirtyRows[nr]) {
        delete dirtyRows[nr][f];
        if (!Object.keys(dirtyRows[nr]).length) {
            delete dirtyRows[nr];
            delete origNrMap[nr];
        }
    }
    const inp = document.querySelector(`input[data-mnr="${nr}"][data-f="${f}"]`);
    if (inp) inp.classList.toggle('dirty', val !== orig);
    updateSaveBar();
}

function addNewRow() {
    const row = { tempId: 'n_' + Date.now() };
    FIELDS_INTERNAL.forEach(f => row[f] = '');
    row.stichtag = '31.12'; // Default-Stichtag

    // Werte des letzten sichtbaren Zählers übernehmen (außer Nr)
    const haus = getSelVals(document.getElementById('f-haus'));
    const einheit = getSelVals(document.getElementById('f-einheit'));
    const typ = getSelVals(document.getElementById('f-typ'));
    let list = getFiltered(haus, einheit, typ);
    if (sortCol) {
        list.sort((a, b) => {
            const cmp = (a[sortCol] || '').localeCompare(b[sortCol] || '', 'de', { sensitivity: 'base' });
            return sortAsc ? cmp : -cmp;
        });
    }
    if (list.length) {
        const last = list[list.length - 1];
        FIELDS_INTERNAL.forEach(f => { if (f !== 'nr') row[f] = last[f] || ''; });
    }

    newRows.push(row);
    updateSaveBar();
    renderMeters();

    // Neue Zeile kurz hervorheben und in den Blick scrollen
    setTimeout(() => {
        const tbody = document.getElementById('m-body');
        const lastTr = tbody.lastElementChild;
        if (lastTr) {
            lastTr.classList.add('hl');
            lastTr.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => lastTr.classList.remove('hl'), 1600);
        }
    }, 30);
}

function updateSaveBar() {
    const bar = document.getElementById('savebar');
    const info = document.getElementById('save-info');
    const actions = document.getElementById('edit-actions');
    const mainActions = document.getElementById('main-edit-actions');
    const ed = Object.keys(dirtyRows).length;
    const nw = newRows.length;
    const dl = deletedNrs.length;

    const hasChanges = !!(ed || nw || dl);
    bar.style.display = hasChanges ? 'inline-flex' : 'none';
    if (actions) actions.style.display = hasChanges ? 'none' : 'inline-flex';
    if (mainActions) mainActions.style.display = hasChanges ? 'none' : 'inline-flex';

    if (hasChanges) {
        const p = [];
        if (ed) p.push(ed + ' geändert');
        if (nw) p.push(nw + ' neu');
        if (dl) p.push(dl + ' gelöscht');
        info.textContent = p.join(', ');
    }
}

async function saveAllChanges() {
    const btn = document.getElementById('btn-save');
    btn.disabled = true; btn.textContent = '…';
    try {
        // 1. Geänderte Zeilen speichern
        for (const [nr, changes] of Object.entries(dirtyRows)) {
            const m = meters.find(x => x.nr === nr);
            if (!m) continue;
            const updated = { ...m, ...changes };
            if (changes.nr && changes.nr !== nr) {
                updated._origNr = nr;
            }
            await HP.api(API + '?action=meter_save', { method: 'POST', body: updated });
        }
        // 2. Neue Zeilen speichern
        for (const row of newRows) {
            const data = {};
            FIELDS_INTERNAL.forEach(f => data[f] = row[f] || '');
            await HP.api(API + '?action=meter_save', { method: 'POST', body: data });
        }
        // 3. Gelöschte Zeilen löschen
        for (const nr of deletedNrs) {
            await HP.api(API + '?action=meter_delete', { method: 'POST', body: { nr } });
        }
        dirtyRows = {}; origNrMap = {}; newRows = []; deletedNrs = []; forceDateUI.clear();
        updateSaveBar();
        setEditMode(false);
        await loadAll();
        toast('Gespeichert.', 'ok');
    } catch (e) {
        toast('Fehler: ' + e.message, 'err');
    } finally {
        btn.disabled = false; btn.textContent = '✓ Speichern';
    }
}

function discardAll() {
    dirtyRows = {}; origNrMap = {}; newRows = []; deletedNrs = [];
    updateSaveBar();
    setEditMode(false);
    toast('Verworfen.', 'info');
}

// ── Ansicht aus Filter erstellen ─────────────────────────────

function updateQuickViewInfo() {
    const haus = getSelVals(document.getElementById('f-haus'));
    const einheit = getSelVals(document.getElementById('f-einheit'));
    const typ = getSelVals(document.getElementById('f-typ'));
    const count = getFiltered(haus, einheit, typ).length;
    const parts = [];
    if (haus.length) parts.push(haus.join(', '));
    if (einheit.length) parts.push(einheit.join(', '));
    if (typ.length) parts.push(typ.join(', '));
    const desc = parts.length ? parts.join(' / ') : 'Alle';
    const qvInfo = document.getElementById('qv-info');
    if (qvInfo) qvInfo.textContent = desc + ' — ' + count + ' Zähler';
}

function showCreateViewModal() {
    const haus = getSelVals(document.getElementById('f-haus'));
    const einheit = getSelVals(document.getElementById('f-einheit'));
    const typ = getSelVals(document.getElementById('f-typ'));

    const parts = [];
    if (haus.length) parts.push(haus.join(', '));
    if (einheit.length) parts.push(einheit.join(', '));
    if (typ.length) parts.push(typ.join(', '));
    const defName = parts.join(' - ') || '';

    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    const c = document.createElement('div');
    c.className = 'modal-c';

    let html = `<h3>Ableser anlegen</h3>`;
    html += `<p style="font-size:13px;color:#666;margin-bottom:12px">Diese Ansicht wird für die aktuellen Filter erstellt.</p>`;
    html += `<div class="f-row"><label>Name des Ablesers</label><input type="text" id="modal-qv-name" value="${esc(defName)}" placeholder="z.B. Meschede EG" style="width:100%"></div>`;
    html += `<div style="display:flex;gap:6px;justify-content:flex-end;margin-top:15px">
        <button class="b" id="modal-qv-cancel">Abbrechen</button>
        <button class="b b-ok" id="modal-qv-run">Anlegen</button>
    </div>`;

    c.innerHTML = html;
    ov.appendChild(c);
    document.body.appendChild(ov);

    const inp = c.querySelector('#modal-qv-name');
    inp.focus();

    c.querySelector('#modal-qv-cancel').onclick = () => ov.remove();
    c.querySelector('#modal-qv-run').onclick = async () => {
        const name = inp.value.trim();
        if (!name) { toast('Bitte einen Namen eingeben.', 'warn'); inp.focus(); return; }

        const haus = getSelVals(document.getElementById('f-haus'));
        const einheit = getSelVals(document.getElementById('f-einheit'));
        const typ = getSelVals(document.getElementById('f-typ'));

        const data = {
            id: '',
            token: '',
            name: name,
            filter: {
                haus: haus.length === 1 ? haus[0] : '',
                einheit: einheit,
                typ: typ.length === 1 ? typ[0] : '',
            },
        };

        const btn = c.querySelector('#modal-qv-run');
        btn.disabled = true;
        try {
            await HP.api(API + '?action=view_save', { method: 'POST', body: data });
            ov.remove();
            await loadAll();
            toast('Ansicht "' + name + '" erstellt.', 'ok');
            switchTab('views');
        } catch (e) {
            toast('Fehler: ' + e.message, 'err');
        } finally {
            btn.disabled = false;
        }
    };
}

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('act'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('act'));
    const tab = document.querySelector('.tab[data-tab="' + tabName + '"]');
    if (tab) tab.classList.add('act');
    document.getElementById('p-' + tabName).classList.add('act');
    // Tab in URL speichern
    const params = new URLSearchParams(window.location.search);
    params.set('tab', tabName);
    history.replaceState(null, '', window.location.pathname + '?' + params.toString());
    if (tabName === 'overview') {
        loadFiltersFromUrl();
        loadOverview();
    }
}

// ── Ansichten (Inline) ───────────────────────────────────────

function initViewEvents() {
    document.getElementById('v-head').addEventListener('click', e => {
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        const col = th.dataset.sort;
        if (sortColView === col) sortAscView = !sortAscView;
        else { sortColView = col; sortAscView = true; }
        renderViews();
    });
}

function renderViews() {
    const tbody = document.getElementById('v-body');
    tbody.innerHTML = '';

    const viewList = views.map(v => {
        const matched = getFilteredByView(v.filter);
        const fDesc = buildFilterDesc(v.filter);
        return { v, matched, fDesc };
    });
    if (sortColView) {
        viewList.sort((a, b) => {
            let va, vb;
            if (sortColView === 'name') { va = (a.v.name || ''); vb = (b.v.name || ''); }
            else if (sortColView === 'filter') { va = (a.fDesc || ''); vb = (b.fDesc || ''); }
            else if (sortColView === 'count') { va = a.matched.length; vb = b.matched.length; }
            else if (sortColView === 'zeitraum') { va = (a.v.editableFrom || 'zzzz'); vb = (b.v.editableFrom || 'zzzz'); }
            else return 0;
            if (typeof va === 'number' && typeof vb === 'number') return sortAscView ? va - vb : vb - va;
            const cmp = String(va).localeCompare(String(vb), 'de', { sensitivity: 'base' });
            return sortAscView ? cmp : -cmp;
        });
    }

    viewList.forEach(({ v, matched, fDesc }) => {
        const baseUrl = window.location.href.replace(/admin\/.*$/, '');
        const link = baseUrl + 'readings/?name=' + encodeURIComponent(v.name);

        if (editingViewId === v.id) {
            appendViewEditRow(tbody, v);
        } else {
            const chartLink = baseUrl + 'readings/chart.html?name=' + encodeURIComponent(v.name);
            const editFrom = v.editableFrom || '';
            const editUntil = v.editableUntil || '';
            const editFromDisplay = editFrom ? HP.formatDate(editFrom) : '—';
            const editUntilDisplay = editUntil ? HP.formatDate(editUntil) : '—';
            const rangeDisplay = editFromDisplay + (editUntil ? ' bis ' + editUntilDisplay : '');

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <b>${esc(v.name)}</b>
                    <div class="row-sub mod-mobile">
                        <span>${matched.length} Zähler</span> · 
                        <span>${esc(rangeDisplay)}</span>
                    </div>
                </td>
                <td class="col-desk">${esc(fDesc)}</td>
                <td class="col-desk text-center">${matched.length}</td>
                <td style="white-space:nowrap" class="col-desk"><span class="ef-display">${esc(rangeDisplay)}</span></td>
                <td>
                    <div class="row-sub mod-mobile" style="margin-bottom:4px">${esc(fDesc)}</div>
                    <div class="row-actions">
                        <button class="b b-p btn-copy" title="Link kopieren">📋</button>
                        <a href="${esc(link)}" class="b b-p" title="Ablesung öffnen" target="_blank">↗</a>
                        <a href="${esc(chartLink)}" class="b b-p" title="Diagramm" target="_blank">📈</a>
                    </div>
                </td>
                <td style="white-space:nowrap" class="v-actions"></td>`;
            tr.querySelector('.btn-copy').onclick = (e) => { e.preventDefault(); navigator.clipboard.writeText(link); toast('Kopiert!', 'ok'); };
            const tdAct = tr.lastElementChild;
            const btnEdit = mk('button', '✏', 'b b-p');
            btnEdit.onclick = () => { editingViewId = v.id; renderViews(); };
            const btnDel = mk('button', '✕', 'b b-d');
            btnDel.onclick = () => deleteView(v.id);
            tdAct.appendChild(btnEdit);
            tdAct.appendChild(document.createTextNode(' '));
            tdAct.appendChild(btnDel);
            tbody.appendChild(tr);
        }
    });

    if (editingViewId === 'NEW') {
        appendViewEditRow(tbody, null);
    }

    if (!views.length && editingViewId !== 'NEW') {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="6" style="color:#999;text-align:center;padding:8px">Noch keine Ansichten.</td>';
        tbody.appendChild(tr);
    }
}

function appendViewEditRow(tbody, existingView) {
    const tr = document.createElement('tr');
    tr.className = 'v-edit';
    const td = document.createElement('td');
    td.colSpan = 6;

    const allHaus = [...new Set(meters.map(m => m.haus).filter(Boolean))].sort();
    const allEinheit = [...new Set(meters.map(m => m.einheit).filter(Boolean))].sort();
    const allTyp = [...new Set(meters.map(m => m.typ).filter(Boolean))].sort();

    const div = document.createElement('div');
    div.className = 'v-form';

    // Name
    const nameWrap = document.createElement('div');
    nameWrap.innerHTML = '<label>Name</label>';
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = existingView ? existingView.name : '';
    nameInp.placeholder = 'z.B. HG 31 - OG';
    nameInp.style.width = '140px';
    nameWrap.appendChild(nameInp);
    div.appendChild(nameWrap);

    // Haus
    const hausWrap = document.createElement('div');
    hausWrap.innerHTML = '<label>Haus</label>';
    const hausSel = document.createElement('select');
    hausSel.innerHTML = '<option value="">Alle</option>';
    allHaus.forEach(h => { const o = document.createElement('option'); o.value = h; o.textContent = h; hausSel.appendChild(o); });
    if (existingView && existingView.filter.haus) hausSel.value = existingView.filter.haus;
    hausWrap.appendChild(hausSel);
    div.appendChild(hausWrap);

    // Einheit
    const einWrap = document.createElement('div');
    einWrap.innerHTML = '<label>Einheit</label>';
    const einMsel = document.createElement('div');
    einMsel.id = 've-einheit';
    einMsel.className = 'msel';
    einWrap.appendChild(einMsel);
    div.appendChild(einWrap);

    // Typ
    const typWrap = document.createElement('div');
    typWrap.innerHTML = '<label>Typ</label>';
    const typMsel = document.createElement('div');
    typMsel.id = 've-typ';
    typMsel.className = 'msel';
    typWrap.appendChild(typMsel);
    div.appendChild(typWrap);

    // Änderbar ab
    const efWrap = document.createElement('div');
    efWrap.innerHTML = '<label>Änderbar ab</label>';
    const efInp = document.createElement('input');
    efInp.type = 'date';
    efInp.value = existingView ? (existingView.editableFrom || '') : '';
    efInp.style.width = '140px';
    efWrap.appendChild(efInp);
    const efTodayBtn = mk('button', 'Heute', 'b b-p');
    efTodayBtn.onclick = () => { efInp.value = new Date().toISOString().slice(0, 10); };
    efTodayBtn.style.marginLeft = '4px';
    efWrap.appendChild(efTodayBtn);
    const efClearBtn = mk('button', '✕', 'b');
    efClearBtn.style.marginLeft = '2px';
    efClearBtn.title = 'Entfernen';
    efClearBtn.onclick = () => { efInp.value = ''; };
    efWrap.appendChild(efClearBtn);
    div.appendChild(efWrap);

    // Änderbar bis
    const etWrap = document.createElement('div');
    etWrap.innerHTML = '<label>Änderbar bis</label>';
    const etInp = document.createElement('input');
    etInp.type = 'date';
    etInp.value = existingView ? (existingView.editableUntil || '') : '';
    etInp.style.width = '140px';
    etWrap.appendChild(etInp);
    const etTodayBtn = mk('button', 'Heute', 'b b-p');
    etTodayBtn.onclick = () => { etInp.value = new Date().toISOString().slice(0, 10); };
    etTodayBtn.style.marginLeft = '4px';
    etWrap.appendChild(etTodayBtn);
    const etClearBtn = mk('button', '✕', 'b');
    etClearBtn.style.marginLeft = '2px';
    etClearBtn.title = 'Entfernen';
    etClearBtn.onclick = () => { etInp.value = ''; };
    etWrap.appendChild(etClearBtn);
    div.appendChild(etWrap);

    // Vorschau
    const previewWrap = document.createElement('div');
    previewWrap.innerHTML = '<label>Vorschau: <b class="pv-count">0</b> Zähler</label>';
    const previewDiv = document.createElement('div');
    previewDiv.className = 'v-preview';
    previewWrap.appendChild(previewDiv);
    div.appendChild(previewWrap);

    // Buttons
    const btnWrap = document.createElement('div');
    btnWrap.style.display = 'flex';
    btnWrap.style.gap = '4px';
    btnWrap.style.alignItems = 'flex-end';
    const btnSave = mk('button', '✓ Speichern', 'b b-ok');
    const btnCancel = mk('button', 'Abbrechen', 'b');
    btnWrap.appendChild(btnSave);
    btnWrap.appendChild(btnCancel);
    div.appendChild(btnWrap);

    td.appendChild(div);
    tr.appendChild(td);
    tbody.appendChild(tr);

    function updatePreview() {
        const filter = {
            haus: hausSel.value,
            einheit: mselGetVals('ve-einheit'),
            typ: mselGetVals('ve-typ').length === 1 ? mselGetVals('ve-typ')[0] : '', // Typ ist im Filter-Modell meist ein String oder wird als solcher behandelt
        };
        const matched = getFilteredByView(filter);
        previewWrap.querySelector('.pv-count').textContent = matched.length;
        previewDiv.innerHTML = matched.map(m => esc(m.bezeichnung) + ' (' + esc(m.haus) + '/' + esc(m.einheit) + ')').join('<br>') || '<em>Keine</em>';
    }
    hausSel.addEventListener('change', updatePreview);
    mselInit('ve-einheit', updatePreview);
    mselInit('ve-typ', updatePreview);
    mselSetOptions('ve-einheit', allEinheit);
    mselSetOptions('ve-typ', allTyp);
    if (existingView && existingView.filter.einheit) mselSetVals('ve-einheit', existingView.filter.einheit);
    if (existingView && existingView.filter.typ) mselSetVals('ve-typ', Array.isArray(existingView.filter.typ) ? existingView.filter.typ : [existingView.filter.typ]);
    updatePreview();

    btnSave.onclick = async () => {
        const data = {
            id: existingView ? existingView.id : '',
            token: existingView ? existingView.token : '',
            name: nameInp.value,
            filter: {
                haus: hausSel.value,
                einheit: mselGetVals('ve-einheit'),
                typ: mselGetVals('ve-typ').length === 1 ? mselGetVals('ve-typ')[0] : mselGetVals('ve-typ'),
            },
            editableFrom: efInp.value || '',
            editableUntil: etInp.value || '',
        };
        try {
            await HP.api(API + '?action=view_save', { method: 'POST', body: data });
            editingViewId = null;
            await loadAll();
            toast('Ansicht gespeichert.', 'ok');
        } catch (e) {
            toast('Fehler: ' + e.message, 'err');
        }
    };

    btnCancel.onclick = () => { editingViewId = null; renderViews(); };
    setTimeout(() => nameInp.focus(), 30);
}

function buildFilterDesc(filter) {
    const parts = [];
    if (filter.haus) parts.push(filter.haus);
    if (filter.einheit && filter.einheit.length) parts.push(filter.einheit.join(', '));
    if (filter.typ) parts.push(filter.typ);
    return parts.join(' | ') || '—';
}

async function deleteView(id) {
    if (!confirm('Ansicht löschen?')) return;
    try {
        await HP.api(API + '?action=view_delete', { method: 'POST', body: { id } });
        await loadAll();
        toast('Gelöscht.', 'ok');
    } catch (e) {
        toast('Fehler: ' + e.message, 'err');
    }
}

// ── Übersicht ────────────────────────────────────────────────

function initOverviewEvents() {
    const ovFilterChange = () => { syncFiltersToUrl(); renderOverview(); };
    document.getElementById('of-haus').addEventListener('change', ovFilterChange);
    mselInit('of-einheit', ovFilterChange);
    mselInit('of-typ', ovFilterChange);
    mselInit('of-werte', ovFilterChange);
    mselInit('of-jahr', ovFilterChange);
    document.getElementById('ov-scroll').addEventListener('click', e => {
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        const col = th.dataset.sort;
        if (sortColOv === col) sortAscOv = !sortAscOv;
        else { sortColOv = col; sortAscOv = true; }
        renderOverview();
    });
}

async function loadOverview() {
    try {
        readings = await HP.api(API + '?action=readings');
        refreshYearFilter();
        // Filter aus URL erneut anwenden (stellt sicher, dass haus/jahr beim direkten Aufruf korrekt sind)
        loadFiltersFromUrl();
        renderOverview();
    } catch (e) {
        toast('Fehler beim Laden.', 'err');
    }
}

function refreshYearFilter() {
    const el = document.getElementById('of-jahr');
    const yearSet = {};
    readings.forEach(r => { if (r.datum) yearSet[r.datum.slice(0, 4)] = true; });
    // Aktuelles Jahr immer hinzufügen
    yearSet[new Date().getFullYear().toString()] = true;
    const years = Object.keys(yearSet).sort();

    mselSetOptions('of-jahr', years);

    // URL-Wert wiederherstellen
    const params = new URLSearchParams(window.location.search);
    const urlJahre = (params.get('jahr') || '').split('|').filter(Boolean);
    if (urlJahre.length) mselSetVals('of-jahr', urlJahre);
}

function getSelectedYear() {
    return getSelVals(document.getElementById('of-jahr'));
}

function filterByYear(items, yearVal) {
    if (!yearVal) return items;
    return items.filter(function (item) {
        var d = typeof item === 'string' ? item : item.datum;
        return d.startsWith(yearVal);
    });
}

function renderOverview() {
    const haus = getSelVals(document.getElementById('of-haus'));
    const einheit = getSelVals(document.getElementById('of-einheit'));
    const typ = getSelVals(document.getElementById('of-typ'));
    const filtered = getFiltered(haus, einheit, typ);
    const filteredIds = new Set(filtered.map(m => m.nr));
    const showWerte = getSelVals(document.getElementById('of-werte'));
    const isWerteSel = showWerte.length > 0;

    const jahr = getSelectedYear();

    // Schritt 1: Readings pro Datum zusammenfassen
    // datumMap: datum → { viewNames: [name, ...], ids: [id, ...], readings: [r, ...] }
    const datumMap = {};
    readings.forEach(r => {
        const d = r.datum;
        if (!datumMap[d]) datumMap[d] = { datum: d, viewNames: [], ids: [], readings: [] };
        const vn = r.viewName || '';
        if (vn && datumMap[d].viewNames.indexOf(vn) === -1) datumMap[d].viewNames.push(vn);
        datumMap[d].ids.push(r.id);
        datumMap[d].readings.push(r);
    });

    // Sortierte Daten
    let datumList = Object.values(datumMap);
    datumList.sort((a, b) => a.datum.localeCompare(b.datum));
    if (jahr.length) datumList = datumList.filter(d => jahr.some(y => d.datum.startsWith(y)));

    // Schritt 2: Pro Datum prüfen welche Sub-Spalten (M/A, Aktuell) vorhanden sind
    // Und eine merged valMap bauen: meterId|datum → { wertMA: mergedStr, wertAktuell: mergedStr }
    const mergedValMap = {}; // meterId|datum → { wertMA, wertAktuell }
    const datumSubMap = {}; // datum → { hasMA, hasAk }

    datumList.forEach(dObj => {
        const d = dObj.datum;
        if (!datumSubMap[d]) datumSubMap[d] = { hasMA: false, hasAk: false };

        // Für jeden Zähler: alle Werte von allen Readings dieses Datums sammeln
        // Nur Werte verwenden, wo der Zähler zur Ansicht des Readings gehört (Filter-Respekt)
        const meterVals = {}; // meterId → { maVals: [{val, vn}], akVals: [{val, vn}] }
        dObj.readings.forEach(r => {
            const vn = r.viewName || '';
            const viewAllowed = getViewAllowedMeterIds(vn);
            const werte = r.werte || {};
            Object.entries(werte).forEach(([mid, vals]) => {
                if (!filteredIds.has(mid)) return;
                if (!viewAllowed.has(mid)) return; // Zähler gehört nicht zur Ansicht → ignorieren
                if (!meterVals[mid]) meterVals[mid] = { maVals: [], akVals: [] };
                const ma = vals.wertMA || '';
                const ak = vals.wertAktuell || '';
                if (ma) { meterVals[mid].maVals.push({ val: ma, vn }); datumSubMap[d].hasMA = true; }
                if (ak) { meterVals[mid].akVals.push({ val: ak, vn }); datumSubMap[d].hasAk = true; }
            });
        });

        // Merge: gleiche Werte → einer, unterschiedlich → val1 / val2
        Object.entries(meterVals).forEach(([mid, data]) => {
            const key = mid + '|' + d;
            const mergeVals = (items) => {
                if (!items.length) return '';
                const unique = [...new Set(items.map(i => i.val))];
                if (unique.length === 1) return unique[0];
                // Unterschiedliche Werte: mit Namen anzeigen
                return items.map(i => i.val + ' (' + i.vn + ')').join(' / ');
            };
            mergedValMap[key] = {
                wertMA: mergeVals(data.maVals),
                wertAktuell: mergeVals(data.akVals),
                maConflict: new Set(data.maVals.map(i => i.val)).size > 1,
                akConflict: new Set(data.akVals.map(i => i.val)).size > 1,
            };
        });
    });

    // M/A Gesamt Logik (periodenbasiert)
    let periodYears = [];
    if (!isWerteSel || showWerte.includes('M/A Gesamt')) {
        const periodData = {};
        const yearsFound = new Set();
        readings.forEach(r => {
            const d = r.datum;
            const viewAllowed = getViewAllowedMeterIds(r.viewName || '');
            Object.entries(r.werte || {}).forEach(([mid, vals]) => {
                if (!filteredIds.has(mid)) return;
                if (!viewAllowed.has(mid)) return; // Zähler gehört nicht zur Ansicht → ignorieren
                const ma = vals.wertMA || '';
                if (!ma) return;
                const mObj = meters.find(m => m.nr === mid);
                const y = getStichtagYear(d, mObj ? mObj.stichtag : '31.12');
                if (!periodData[y]) periodData[y] = {};
                if (!periodData[y][mid] || d > periodData[y][mid].datum) periodData[y][mid] = { val: ma, datum: d };
                yearsFound.add(y);
            });
        });
        periodYears = [...yearsFound].sort((a, b) => b - a);
        if (jahr.length) periodYears = periodYears.filter(y => jahr.includes(String(y)));
        periodYears.forEach(y => {
            Object.entries(periodData[y]).forEach(([mid, data]) => {
                mergedValMap[mid + '|P' + y] = { wertMA: data.val, wertAktuell: '', maConflict: false, akConflict: false };
            });
        });
    }

    // Schritt 3: Display-Spalten (pro Datum, nicht pro datum+viewName)
    const displayCols = [];
    datumList.forEach(dObj => {
        const info = datumSubMap[dObj.datum] || {};
        let first = true;
        const sMA = !isWerteSel || showWerte.includes('M/A');
        const sAk = !isWerteSel || showWerte.includes('Aktuell');
        if (info.hasMA && sMA) { displayCols.push({ ...dObj, sc: 'M/A', isFirst: first }); first = false; }
        if (info.hasAk && sAk) { displayCols.push({ ...dObj, sc: 'Aktuell', isFirst: first }); first = false; }
    });

    if (!isWerteSel || showWerte.includes('M/A Gesamt')) {
        periodYears.forEach(y => {
            displayCols.unshift({ datum: 'P' + y, sc: 'M/A ' + y, isFirst: true, isGesamt: true, viewNames: [], ids: [] });
        });
    }

    if (displayCols.length === 0) {
        displayCols.push({ isPlaceholder: true, sc: 'Keine Daten vorhanden', viewNames: [], ids: [] });
    }

    // Sortieren nach gewählter Spalte
    const sorted = filtered.slice().sort((a, b) => {
        const col = sortColOv || 'haus';
        const va = a[col] || '';
        const vb = b[col] || '';
        const cmp = String(va).localeCompare(String(vb), 'de', { sensitivity: 'base' });
        return sortAscOv ? cmp : -cmp;
    });

    // Schritt 4+5: Nach Haus gruppieren, ein Block/Tabelle pro Haus (Haus als Überschrift, keine Haus-Spalte)
    const ovBaseUrl = window.location.href.replace(/admin\/.*$/, '');
    const byHaus = {};
    sorted.forEach(m => {
        const hasAnyData = displayCols.some(dc => {
            const v = mergedValMap[m.nr + '|' + dc.datum];
            if (!v) return false;
            const val = (dc.sc === 'M/A' || dc.isGesamt) ? (v.wertMA || '') : (v.wertAktuell || '');
            return val !== '';
        });
        const isActive = displayCols.some(dc => HP.isMeterActive(m, dc.datum));
        if (!isActive && !hasAnyData) return;
        const h = m.haus || 'Ohne Haus';
        if (!byHaus[h]) byHaus[h] = [];
        byHaus[h].push(m);
    });
    const hausOrder = Object.keys(byHaus).sort((a, b) => (a || '').localeCompare(b || '', 'de'));

    const ovScroll = document.getElementById('ov-scroll');
    ovScroll.innerHTML = '';
    hausOrder.forEach(hausName => {
        const block = document.createElement('div');
        block.className = 'ov-haus-block';
        block.innerHTML = '<div class="ov-haus-title">' + esc(hausName) + '</div>';
        const table = document.createElement('table');
        table.className = 'ov-table';

        const thead = document.createElement('thead');
        const thr = document.createElement('tr');
        thr.innerHTML = '<th class="fix-einheit" data-sort="einheit">Einheit</th><th class="fix-bez" data-sort="bezeichnung">Bezeichnung</th><th class="fix-nr" data-sort="nr">Nr.</th>';
        const meterNrsInHouse = new Set(byHaus[hausName].map(m => m.nr));
        displayCols.forEach(dc => {
            const th = document.createElement('th');
            if (dc.isPlaceholder) {
                th.textContent = dc.sc;
                th.style.color = '#999';
                th.style.fontWeight = 'normal';
                thr.appendChild(th);
                return;
            }
            th.style.cursor = 'default';
            let dateStr = dc.isGesamt ? 'Stichtag' : HP.formatDate(dc.datum);
            const relevantReadings = (dc.readings || []).filter(r =>
                Object.keys(r.werte || {}).some(nr => meterNrsInHouse.has(nr))
            );
            const relevantViewNames = [...new Set(relevantReadings.map(r => r.viewName).filter(Boolean))];
            const relevantIds = relevantReadings.map(r => r.id);
            let label;
            if (!dc.isGesamt && relevantViewNames.length) {
                const nameParts = relevantViewNames.map(vn => {
                    const readingUrl = ovBaseUrl + 'readings/?name=' + encodeURIComponent(vn) + '&datum=' + encodeURIComponent(dc.datum) + '&force=1';
                    return '<a href="' + esc(readingUrl) + '" target="_blank" style="color:#07c;text-decoration:none" title="Ablesung ' + esc(vn) + ' öffnen">' + esc(vn) + '</a>';
                });
                label = dateStr + '<br>' + nameParts.join(' ');
                if (dc.isFirst && relevantIds.length) {
                    label += ' <button class="b b-d ov-del" data-rids="' + esc(relevantIds.join('|')) + '" style="font-size:9px;padding:0 4px">✕</button>';
                }
                label += '<br>' + esc(dc.sc);
                const notizen = relevantReadings.map(r => { const n = (r.notizen || '').trim(); return n ? (relevantViewNames.length > 1 ? esc(r.viewName || '') + ': ' + esc(n) : esc(n)) : null; }).filter(Boolean);
                if (notizen.length) label += '<br><span class="ov-notiz" style="display:block;max-width:140px;overflow-wrap:break-word;word-break:break-word">"' + notizen.join('; ') + '"</span>';
            } else {
                label = dateStr + ' ' + esc(dc.sc);
                if (dc.isFirst && relevantIds.length) {
                    label += ' <button class="b b-d ov-del" data-rids="' + esc(relevantIds.join('|')) + '" style="font-size:9px;padding:0 4px">✕</button>';
                }
            }
            th.innerHTML = label;
            thr.appendChild(th);
        });
        thead.appendChild(thr);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        byHaus[hausName].forEach(m => {
            const tr = document.createElement('tr');
            tr.innerHTML = '<td class="fix-einheit">' + esc(m.einheit) + '</td><td class="fix-bez">' + esc(m.bezeichnung) + '</td><td class="fix-nr">' + esc(m.nr) + '</td>';
            displayCols.forEach(dc => {
                const td = document.createElement('td');
                if (dc.isPlaceholder) {
                    td.innerHTML = '<span style="color:#eee">—</span>';
                    td.style.textAlign = 'center';
                    tr.appendChild(td);
                    return;
                }
                const v = mergedValMap[m.nr + '|' + dc.datum];
                if (v) {
                    const val = (dc.sc === 'M/A' || dc.isGesamt) ? (v.wertMA || '') : (v.wertAktuell || '');
                    const isConflict = dc.sc === 'M/A' ? v.maConflict : v.akConflict;
                    td.textContent = val;
                    if (isConflict) {
                        td.style.color = '#c62828';
                        td.style.fontWeight = '600';
                        td.title = 'Unterschiedliche Werte von verschiedenen Ablesern';
                    }
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        block.appendChild(table);
        ovScroll.appendChild(block);
    });

    document.querySelectorAll('.ov-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const ids = (btn.dataset.rids || '').split('|').filter(Boolean);
            if (ids.length) deleteReadings(ids);
        });
    });
}

// ── Reading löschen ─────────────────────────────────────────

async function deleteReadings(ids) {
    // Beschreibung für Bestätigungsdialog
    const descs = ids.map(id => {
        const r = readings.find(x => x.id === id);
        return r ? HP.formatDate(r.datum) + (r.viewName ? ' – ' + r.viewName : '') : id;
    });
    if (!confirm('Messung(en) wirklich löschen?\n' + descs.join('\n'))) return;
    try {
        for (const id of ids) {
            await HP.api(API + '?action=reading_delete', { method: 'POST', body: { id } });
            readings = readings.filter(x => x.id !== id);
        }
        renderOverview();
        toast(ids.length + ' Messung(en) gelöscht.', 'ok');
    } catch (e) {
        toast('Fehler: ' + e.message, 'err');
    }
}

// ── Export/Import: Zähler ────────────────────────────────────

function initGlobalMenu() {
    const tBtn = document.getElementById('btn-toggle-edit');
    if (tBtn) {
        tBtn.addEventListener('click', () => setEditMode(false));
    }

    document.getElementById('btn-global-menu').addEventListener('click', function () {
        const activeTab = document.querySelector('.tab.act').dataset.tab;
        const menu = [];

        if (activeTab === 'meters') {
            if (!editMode) {
                menu.push({ label: 'Bearbeiten', icon: '✏️', onClick: () => setEditMode(true) });
                menu.push({ separator: true });
            }
            menu.push({ label: 'Messwerte anzeigen', icon: '📊', onClick: () => switchTab('overview') });
            menu.push({ label: 'Ableser anlegen', icon: '👤', onClick: showCreateViewModal });
            menu.push({ separator: true });
            menu.push({ label: 'CSV exportieren', icon: '📄', onClick: exportMetersCSV });
            menu.push({ label: 'Excel exportieren', icon: '📊', onClick: exportMetersExcel });
        } else if (activeTab === 'overview') {
            menu.push({ label: 'CSV exportieren', icon: '📄', onClick: exportOverviewCSV });
            menu.push({ label: 'Excel exportieren', icon: '📊', onClick: exportOverviewExcel });
            menu.push({ label: 'PDF exportieren', icon: '📕', onClick: exportOverviewPDF });
            menu.push({ separator: true });
            menu.push({ label: 'Backup herunterladen', icon: '💾', onClick: downloadFullBackup });
            menu.push({ label: 'Backup hochladen', icon: '📤', onClick: uploadFullBackup });
        } else if (activeTab === 'views') {
            menu.push({ label: 'Zählerverwaltung', icon: '📐', onClick: () => switchTab('meters') });
            menu.push({ label: 'Messwerte anzeigen', icon: '📊', onClick: () => switchTab('overview') });
        }

        HPExport.createExportMenu(this, menu);
    });
}

function getFilteredMetersForExport() {
    const haus = getSelVals(document.getElementById('f-haus'));
    const einheit = getSelVals(document.getElementById('f-einheit'));
    const typ = getSelVals(document.getElementById('f-typ'));
    let list = getFiltered(haus, einheit, typ);
    if (sortCol) {
        list.sort((a, b) => {
            const cmp = (a[sortCol] || '').localeCompare(b[sortCol] || '', 'de', { sensitivity: 'base' });
            return sortAsc ? cmp : -cmp;
        });
    }
    return list;
}

function exportMetersCSV() {
    const list = getFilteredMetersForExport();
    const header = ['Haus', 'Einheit', 'Bezeichnung', 'Nr', 'Typ', 'Faktor', 'Stichtag', 'Gültig von', 'Gültig bis'];
    const rows = [header];
    list.forEach(m => rows.push([m.haus, m.einheit, m.bezeichnung, m.nr, m.typ, m.faktor || '', m.stichtag || '31.12', m.validFrom || '', m.validTo || '']));
    HPExport.exportCSV(rows, 'zaehler.csv');
    toast('CSV exportiert.', 'ok');
}

function exportMetersExcel() {
    const list = getFilteredMetersForExport();
    const header = ['Haus', 'Einheit', 'Bezeichnung', 'Nr', 'Typ', 'Faktor', 'Stichtag', 'Gültig von', 'Gültig bis'];
    const rows = [header];
    list.forEach(m => rows.push([m.haus, m.einheit, m.bezeichnung, m.nr, m.typ, m.faktor || '', m.stichtag || '31.12', m.validFrom || '', m.validTo || '']));
    HPExport.exportExcel(rows, 'zaehler.xlsx', 'Zähler');
    toast('Excel exportiert.', 'ok');
}

function importMetersCSV() {
    HPExport.promptFileUpload('.csv', async (file) => {
        try {
            const text = await HPExport.readFileAsText(file);
            const rows = HPExport.parseCSV(text);
            await importMetersFromRows(rows);
        } catch (e) {
            toast('Fehler: ' + e.message, 'err');
        }
    });
}

function importMetersExcel() {
    HPExport.promptFileUpload('.xlsx,.xls', async (file) => {
        try {
            const buf = await HPExport.readFileAsArrayBuffer(file);
            const rows = HPExport.parseExcel(buf);
            await importMetersFromRows(rows);
        } catch (e) {
            toast('Fehler: ' + e.message, 'err');
        }
    });
}

async function importMetersFromRows(rows) {
    if (!rows.length) { toast('Keine Daten gefunden.', 'warn'); return; }
    // Mapping: flexible Spaltennamen
    const mapping = {
        'nr': 'nr', 'nr.': 'nr', 'nummer': 'nr', 'zählernr': 'nr', 'zaehlernr': 'nr',
        'bezeichnung': 'bezeichnung', 'name': 'bezeichnung',
        'haus': 'haus', 'gebäude': 'haus', 'gebaeude': 'haus',
        'einheit': 'einheit', 'wohnung': 'einheit',
        'typ': 'typ', 'type': 'typ', 'art': 'typ',
        'faktor': 'faktor', 'factor': 'faktor', 'umrechnungsfaktor': 'faktor',
        'stichtag': 'stichtag', 'deadline': 'stichtag', 'abrechnungsstichtag': 'stichtag',
        'validfrom': 'validFrom', 'von': 'validFrom', 'gültig von': 'validFrom', 'gueltig von': 'validFrom',
        'validto': 'validTo', 'bis': 'validTo', 'gültig bis': 'validTo', 'gueltig bis': 'validTo'
    };
    const mapped = rows.map(r => {
        const m = {};
        Object.keys(r).forEach(k => {
            const mk = mapping[k.toLowerCase()];
            if (mk) m[mk] = String(r[k]);
        });
        return m;
    }).filter(m => m.nr);

    if (!mapped.length) { toast('Keine gültigen Zähler gefunden. Spalte "Nr" benötigt.', 'warn'); return; }
    if (!confirm(mapped.length + ' Zähler importieren?')) return;

    for (const m of mapped) {
        await HP.api(API + '?action=meter_save', {
            method: 'POST',
            body: { nr: m.nr, bezeichnung: m.bezeichnung || '', haus: m.haus || '', einheit: m.einheit || '', typ: m.typ || '', faktor: m.faktor || '', stichtag: m.stichtag || '', validFrom: m.validFrom || '', validTo: m.validTo || '' }
        });
    }
    await loadAll();
    toast(mapped.length + ' Zähler importiert.', 'ok');
}


// ── Export/Import: Messwerte (Overview) ──────────────────────


function getOverviewExportData() {
    const haus = getSelVals(document.getElementById('of-haus'));
    const einheit = getSelVals(document.getElementById('of-einheit'));
    const typ = getSelVals(document.getElementById('of-typ'));
    const filtered = getFiltered(haus, einheit, typ);
    const filteredIds = new Set(filtered.map(m => m.nr));
    const showWerte = getSelVals(document.getElementById('of-werte'));
    const isWerteSel = showWerte.length > 0;
    const jahr = getSelectedYear();

    // Gleiche Merge-Logik wie renderOverview
    const datumMap = {};
    readings.forEach(r => {
        const d = r.datum;
        if (!datumMap[d]) datumMap[d] = { datum: d, viewNames: [], readings: [] };
        const vn = r.viewName || '';
        if (vn && datumMap[d].viewNames.indexOf(vn) === -1) datumMap[d].viewNames.push(vn);
        datumMap[d].readings.push(r);
    });

    let datumList = Object.values(datumMap);
    datumList.sort((a, b) => a.datum.localeCompare(b.datum));
    if (jahr.length) datumList = datumList.filter(d => jahr.some(y => d.datum.startsWith(y)));

    const mergedValMap = {};
    const datumSubMap = {};

    datumList.forEach(dObj => {
        const d = dObj.datum;
        if (!datumSubMap[d]) datumSubMap[d] = { hasMA: false, hasAk: false };
        const meterVals = {};
        dObj.readings.forEach(r => {
            const vn = r.viewName || '';
            const viewAllowed = getViewAllowedMeterIds(vn);
            Object.entries(r.werte || {}).forEach(([mid, vals]) => {
                if (!filteredIds.has(mid)) return;
                if (!viewAllowed.has(mid)) return;
                if (!meterVals[mid]) meterVals[mid] = { maVals: [], akVals: [] };
                const ma = vals.wertMA || '';
                const ak = vals.wertAktuell || '';
                if (ma) { meterVals[mid].maVals.push({ val: ma, vn }); datumSubMap[d].hasMA = true; }
                if (ak) { meterVals[mid].akVals.push({ val: ak, vn }); datumSubMap[d].hasAk = true; }
            });
        });
        Object.entries(meterVals).forEach(([mid, data]) => {
            const mergeVals = (items) => {
                if (!items.length) return '';
                const unique = [...new Set(items.map(i => i.val))];
                if (unique.length === 1) return unique[0];
                return items.map(i => i.val + ' (' + i.vn + ')').join(' / ');
            };
            mergedValMap[mid + '|' + d] = {
                wertMA: mergeVals(data.maVals),
                wertAktuell: mergeVals(data.akVals),
            };
        });
    });

    // M/A Gesamt Logik (periodenbasiert)
    let periodYears = [];
    if (!isWerteSel || showWerte.includes('M/A Gesamt')) {
        const periodData = {};
        const yearsFound = new Set();
        readings.forEach(r => {
            const d = r.datum;
            const viewAllowed = getViewAllowedMeterIds(r.viewName || '');
            Object.entries(r.werte || {}).forEach(([mid, vals]) => {
                if (!filteredIds.has(mid)) return;
                if (!viewAllowed.has(mid)) return;
                const ma = vals.wertMA || '';
                if (!ma) return;
                const mObj = meters.find(m => m.nr === mid);
                const y = getStichtagYear(d, mObj ? mObj.stichtag : '31.12');
                if (!periodData[y]) periodData[y] = {};
                if (!periodData[y][mid] || d > periodData[y][mid].datum) periodData[y][mid] = { val: ma, datum: d };
                yearsFound.add(y);
            });
        });
        periodYears = [...yearsFound].sort((a, b) => b - a);
        if (jahr.length) periodYears = periodYears.filter(y => jahr.includes(String(y)));
        periodYears.forEach(y => {
            Object.entries(periodData[y]).forEach(([mid, data]) => {
                mergedValMap[mid + '|P' + y] = { wertMA: data.val, wertAktuell: '', maConflict: false, akConflict: false };
            });
        });
    }

    const displayCols = [];
    datumList.forEach(dObj => {
        const info = datumSubMap[dObj.datum] || {};
        let first = true;
        const sMA = !isWerteSel || showWerte.includes('M/A');
        const sAk = !isWerteSel || showWerte.includes('Aktuell');
        if (info.hasMA && sMA) { displayCols.push({ ...dObj, sc: 'M/A', isFirst: first }); first = false; }
        if (info.hasAk && sAk) { displayCols.push({ ...dObj, sc: 'Aktuell', isFirst: first }); first = false; }
    });

    if (!isWerteSel || showWerte.includes('M/A Gesamt')) {
        periodYears.forEach(y => {
            displayCols.unshift({ datum: 'P' + y, sc: 'M/A ' + y, isFirst: true, isGesamt: true, viewNames: [], ids: [] });
        });
    }

    const sorted = filtered.slice().filter(m => {
        const hasAnyData = displayCols.some(dc => {
            const v = mergedValMap[m.nr + '|' + dc.datum];
            if (!v) return false;
            const val = (dc.sc === 'M/A' || dc.isGesamt) ? (v.wertMA || '') : (v.wertAktuell || '');
            return val !== '';
        });
        const isActive = displayCols.some(dc => HP.isMeterActive(m, dc.datum));
        return isActive || hasAnyData;
    }).sort((a, b) => {
        const col = sortColOv || 'haus';
        const va = a[col] || '';
        const vb = b[col] || '';
        const cmp = String(va).localeCompare(String(vb), 'de', { sensitivity: 'base' });
        return sortAscOv ? cmp : -cmp;
    });

    return { sorted, displayCols, mergedValMap };
}

function exportOverviewCSV() {
    const { sorted, displayCols, mergedValMap } = getOverviewExportData();
    const header = ['Haus', 'Einheit', 'Bezeichnung', 'Nr.', 'Typ', 'Faktor', 'Stichtag', 'Gültig von', 'Gültig bis'];
    displayCols.forEach(dc => {
        let h = (dc.isGesamt ? 'Stichtag' : HP.formatDate(dc.datum)) + (dc.viewNames.length ? ' ' + dc.viewNames.join(' ') : '') + ' ' + dc.sc;
        const notizen = (dc.readings || []).map(r => { const n = (r.notizen || '').trim(); return n ? (dc.viewNames && dc.viewNames.length > 1 ? (r.viewName || '') + ': ' + n : n) : null; }).filter(Boolean);
        if (notizen.length) h += '\n"' + notizen.join('; ') + '"';
        header.push(h);
    });
    const rows = [header];
    sorted.forEach(m => {
        const row = [m.haus, m.einheit, m.bezeichnung, m.nr, m.typ, m.faktor || '', m.stichtag || '31.12', m.validFrom || '', m.validTo || ''];
        displayCols.forEach(dc => {
            const v = mergedValMap[m.nr + '|' + dc.datum];
            row.push(v ? ((dc.sc === 'M/A' || dc.isGesamt) ? (v.wertMA || '') : (v.wertAktuell || '')) : '');
        });
        rows.push(row);
    });
    HPExport.exportCSV(rows, 'messwerte.csv');
    toast('CSV exportiert.', 'ok');
}

function exportOverviewExcel() {
    const { sorted, displayCols, mergedValMap } = getOverviewExportData();
    const header = ['Haus', 'Einheit', 'Bezeichnung', 'Nr.', 'Typ', 'Faktor', 'Stichtag', 'Gültig von', 'Gültig bis'];
    displayCols.forEach(dc => {
        let h = (dc.isGesamt ? 'Stichtag' : HP.formatDate(dc.datum)) + (dc.viewNames.length ? ' ' + dc.viewNames.join(' ') : '') + ' ' + dc.sc;
        const notizen = (dc.readings || []).map(r => { const n = (r.notizen || '').trim(); return n ? (dc.viewNames && dc.viewNames.length > 1 ? (r.viewName || '') + ': ' + n : n) : null; }).filter(Boolean);
        if (notizen.length) h += '\n"' + notizen.join('; ') + '"';
        header.push(h);
    });
    const rows = [header];
    sorted.forEach(m => {
        const row = [m.haus, m.einheit, m.bezeichnung, m.nr, m.typ, m.faktor || '', m.stichtag || '31.12', m.validFrom || '', m.validTo || ''];
        displayCols.forEach(dc => {
            const v = mergedValMap[m.nr + '|' + dc.datum];
            row.push(v ? ((dc.sc === 'M/A' || dc.isGesamt) ? (v.wertMA || '') : (v.wertAktuell || '')) : '');
        });
        rows.push(row);
    });
    HPExport.exportExcel(rows, 'messwerte.xlsx', 'Messwerte');
    toast('Excel exportiert.', 'ok');
}

function exportOverviewPDF() {
    const { sorted, displayCols, mergedValMap } = getOverviewExportData();
    // PDF: Haus auf Tabellen-Überschrift, keine Spalten Fkt./Sticht./v./b. – ein Tabelle pro Haus
    const headBase = ['Einheit', 'Bez.', 'Nr.'];
    displayCols.forEach(dc => {
        let dStr = dc.isGesamt ? 'Stichtag' : HP.formatDate(dc.datum);
        dStr += (dc.viewNames.length ? '\n' + dc.viewNames.join(' ') : '') + '\n' + dc.sc;
        const notizen = (dc.readings || []).map(r => { const n = (r.notizen || '').trim(); return n ? (dc.viewNames && dc.viewNames.length > 1 ? (r.viewName || '') + ': ' + n : n) : null; }).filter(Boolean);
        if (notizen.length) dStr += '\n"' + notizen.join('; ') + '"';
        headBase.push(dStr);
    });
    const byHaus = {};
    sorted.forEach(m => {
        const h = m.haus || 'Ohne Haus';
        if (!byHaus[h]) byHaus[h] = [];
        byHaus[h].push(m);
    });
    const hausOrder = Object.keys(byHaus).sort((a, b) => (a || '').localeCompare(b || '', 'de'));
    const tables = hausOrder.map(h => {
        const meters = byHaus[h];
        const body = meters.map(m => {
            const row = [m.einheit, m.bezeichnung, m.nr];
            displayCols.forEach(dc => {
                const v = mergedValMap[m.nr + '|' + dc.datum];
                row.push(v ? ((dc.sc === 'M/A' || dc.isGesamt) ? (v.wertMA || '') : (v.wertAktuell || '')) : '');
            });
            return row;
        });
        return { title: h, head: headBase, body };
    });
    HPExport.exportPDF({
        title: 'Messwerte-Übersicht',
        subtitle: sorted.length + ' Zähler, ' + displayCols.length + ' Werte-Spalten',
        tables: tables,
        filename: 'messwerte.pdf',
        orientation: 'landscape'
    });
    toast('PDF exportiert.', 'ok');
}

async function downloadFullBackup() {
    try {
        const res = await fetch('backup.php?action=download');
        if (!res.ok) {
            const text = await res.text();
            let msg = 'HTTP ' + res.status;
            try {
                const data = JSON.parse(text);
                msg = data.error || msg;
            } catch {
                if (text) msg = text;
            }
            throw new Error(msg);
        }

        const blob = await res.blob();
        const cd = res.headers.get('Content-Disposition') || '';
        const m = cd.match(/filename="?([^"]+)"?/i);
        const fallback = 'hp_backup_' + new Date().toISOString().slice(0, 10) + '.zip';
        const filename = (m && m[1]) ? m[1] : fallback;

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        toast('Backup heruntergeladen.', 'ok');
    } catch (e) {
        toast('Backup-Fehler: ' + e.message, 'err');
    }
}

function uploadFullBackup() {
    HPExport.promptFileUpload('.zip', async (file) => {
        if (!file) return;
        if (!confirm('Backup einspielen? Bestehende Dateien können überschrieben werden.')) return;

        const fd = new FormData();
        fd.append('backup', file);

        try {
            const res = await fetch('backup.php?action=upload', { method: 'POST', body: fd });
            const text = await res.text();
            let data = null;
            try {
                data = JSON.parse(text);
            } catch {
                throw new Error(text || ('HTTP ' + res.status));
            }
            if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));

            const created = Array.isArray(data.created) ? data.created : [];
            const overwritten = Array.isArray(data.overwritten) ? data.overwritten : [];
            const createdEntries = Array.isArray(data.createdEntries) ? data.createdEntries : [];
            const overwrittenEntries = Array.isArray(data.overwrittenEntries) ? data.overwrittenEntries : [];
            const skipped = Array.isArray(data.skipped) ? data.skipped : [];

            const hasEntryReport = createdEntries.length || overwrittenEntries.length;
            const okMsg = hasEntryReport
                ? ('Backup eingespielt: ' + createdEntries.length + ' Einträge neu, ' + overwrittenEntries.length + ' Einträge überschrieben.')
                : ('Backup eingespielt: ' + created.length + ' Datei(en) neu, ' + overwritten.length + ' Datei(en) überschrieben.');
            toast(okMsg, 'ok');

            let details = 'Backup erfolgreich eingespielt.';
            if (hasEntryReport) {
                details += '\n\nNeue Einträge (' + createdEntries.length + '):\n' + (createdEntries.length ? createdEntries.join('\n') : '—');
                details += '\n\nÜberschriebene Einträge (' + overwrittenEntries.length + '):\n' + (overwrittenEntries.length ? overwrittenEntries.join('\n') : '—');
                details += '\n\nBetroffene Dateien (neu/aktualisiert):\n' + ((created.length || overwritten.length) ? created.concat(overwritten).join('\n') : '—');
            } else {
                details += '\n\nNeu (' + created.length + '):\n' + (created.length ? created.join('\n') : '—');
                details += '\n\nÜberschrieben (' + overwritten.length + '):\n' + (overwritten.length ? overwritten.join('\n') : '—');
            }
            if (skipped.length) {
                details += '\n\nÜbersprungen (' + skipped.length + '):\n' + skipped.join('\n');
            }
            alert(details);

            await loadAll();
        } catch (e) {
            toast('Backup-Fehler: ' + e.message, 'err');
        }
    });
}

async function deleteFilteredMeters() {
    const list = getFilteredMetersForExport();
    if (!list.length) { toast('Keine Zähler zum Löschen gefunden.', 'warn'); return; }

    if (!confirm(`${list.length} Zähler wirklich unwiderruflich löschen?`)) return;

    try {
        for (const m of list) {
            await HP.api(API + '?action=meter_delete', { method: 'POST', body: { nr: m.nr } });
        }
        await loadAll();
        toast(`${list.length} Zähler gelöscht.`, 'ok');
    } catch (e) {
        toast('Fehler beim Löschen: ' + e.message, 'err');
    }
}

// ── Helpers ──────────────────────────────────────────────────

function mk(tag, text, cls) {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    return el;
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function toast(msg, type) {
    const c = document.getElementById('toast');
    const colors = { ok: '#2e7d32', err: '#c62828', warn: '#f57f17', info: '#1565c0' };
    const t = document.createElement('div');
    t.className = 'tmsg';
    t.style.background = colors[type] || colors.info;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}

function getStichtagYear(dateStr, stichtagStr) {
    if (!stichtagStr || !stichtagStr.includes('.')) stichtagStr = '31.12';
    const parts = stichtagStr.split('.');
    const d = parseInt(parts[0]);
    const m = parseInt(parts[1]);
    const rDate = new Date(dateStr);
    const rYear = rDate.getFullYear();
    const sDateCurrent = new Date(rYear, m - 1, d);
    return rDate <= sDateCurrent ? rYear - 1 : rYear;
}
