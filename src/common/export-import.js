/**
 * Hauspunkt – Export/Import Utilities
 * CSV, Excel (XLSX), PDF Export/Import für Zähler, Messwerte, Ablesungen.
 * Benötigt: xlsx.full.min.js, jspdf.umd.min.js, jspdf.plugin.autotable.min.js
 */

const HPExport = {
    // ── CSV Export ────────────────────────────────────────────────
    exportCSV(rows, filename) {
        const sep = ';';
        const csv = rows.map(row =>
            row.map(cell => {
                const str = String(cell ?? '');
                return str.includes(sep) || str.includes('"') || str.includes('\n')
                    ? '"' + str.replace(/"/g, '""') + '"'
                    : str;
            }).join(sep)
        ).join('\r\n');
        const bom = '\uFEFF';
        const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
        HPExport._download(blob, filename);
    },

    // ── CSV Import (parse) ───────────────────────────────────────
    parseCSV(text) {
        // Entferne BOM
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return [];
        // Detect separator
        const sep = lines[0].includes(';') ? ';' : ',';
        const header = HPExport._parseCSVLine(lines[0], sep).map(h => h.trim().toLowerCase());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = HPExport._parseCSVLine(lines[i], sep);
            const obj = {};
            header.forEach((h, idx) => { obj[h] = (cols[idx] || '').trim(); });
            rows.push(obj);
        }
        return rows;
    },

    _parseCSVLine(line, sep) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (inQuotes) {
                if (c === '"') {
                    if (i + 1 < line.length && line[i + 1] === '"') {
                        current += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    current += c;
                }
            } else {
                if (c === '"') {
                    inQuotes = true;
                } else if (c === sep) {
                    result.push(current);
                    current = '';
                } else {
                    current += c;
                }
            }
        }
        result.push(current);
        return result;
    },

    // ── Excel Export ─────────────────────────────────────────────
    exportExcel(rows, filename, sheetName) {
        if (typeof XLSX === 'undefined') { alert('Excel-Bibliothek nicht geladen.'); return; }
        sheetName = sheetName || 'Daten';
        const ws = XLSX.utils.aoa_to_sheet(rows);
        // Spaltenbreiten automatisch berechnen
        const colWidths = [];
        rows.forEach(row => {
            row.forEach((cell, i) => {
                const len = String(cell ?? '').length;
                if (!colWidths[i] || len > colWidths[i]) colWidths[i] = len;
            });
        });
        ws['!cols'] = colWidths.map(w => ({ wch: Math.min(Math.max(w + 2, 8), 40) }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        XLSX.writeFile(wb, filename);
    },

    // ── Excel Import (parse) ─────────────────────────────────────
    parseExcel(arrayBuffer) {
        if (typeof XLSX === 'undefined') { alert('Excel-Bibliothek nicht geladen.'); return []; }
        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (raw.length < 2) return [];
        const header = raw[0].map(h => String(h).trim().toLowerCase());
        const rows = [];
        for (let i = 1; i < raw.length; i++) {
            const obj = {};
            header.forEach((h, idx) => { obj[h] = String(raw[i][idx] ?? '').trim(); });
            rows.push(obj);
        }
        return rows;
    },

    // ── PDF Export (Tabelle) ─────────────────────────────────────
    exportPDF(config) {
        if (typeof jspdf === 'undefined') { alert('PDF-Bibliothek nicht geladen.'); return; }
        const { jsPDF } = jspdf;
        const doc = new jsPDF({
            orientation: config.orientation || 'landscape',
            unit: 'mm',
            format: 'a4'
        });
        const pageW = doc.internal.pageSize.getWidth();

        // Titel
        doc.setFontSize(14);
        doc.text(config.title || 'Hauspunkt Export', 10, 12);
        if (config.subtitle) {
            doc.setFontSize(9);
            doc.setTextColor(120);
            doc.text(config.subtitle, 10, 18);
            doc.setTextColor(0);
        }

        // Datum
        doc.setFontSize(8);
        doc.text('Erstellt: ' + new Date().toLocaleDateString('de-DE'), pageW - 10, 12, { align: 'right' });

        const startY = config.subtitle ? 22 : 16;

        doc.autoTable({
            head: [config.head],
            body: config.body,
            startY: startY,
            styles: { fontSize: 8, cellPadding: 1.5, lineColor: [200, 200, 200], lineWidth: 0.1 },
            headStyles: { fillColor: [240, 240, 240], textColor: [40, 40, 40], fontStyle: 'bold', lineWidth: 0.1 },
            alternateRowStyles: { fillColor: [250, 250, 250] },
            margin: { left: 10, right: 10 },
            didDrawPage: function (data) {
                // Footer
                doc.setFontSize(7);
                doc.setTextColor(150);
                doc.text('Hauspunkt', 10, doc.internal.pageSize.getHeight() - 5);
                doc.text('Seite ' + doc.internal.getNumberOfPages(), pageW - 10, doc.internal.pageSize.getHeight() - 5, { align: 'right' });
            }
        });

        if (typeof config.afterDraw === 'function') {
            config.afterDraw(doc, doc.lastAutoTable.finalY, pageW);
        }

        doc.save(config.filename || 'export.pdf');
    },

    // ── PDF Export mit ausfüllbaren Feldern ──────────────────────
    exportPDFForm(config) {
        if (typeof jspdf === 'undefined') { alert('PDF-Bibliothek nicht geladen.'); return; }
        const { jsPDF } = jspdf;
        const doc = new jsPDF({
            orientation: config.orientation || 'portrait',
            unit: 'mm',
            format: 'a4'
        });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const marginL = 10;
        const marginR = 10;
        const usableW = pageW - marginL - marginR;

        // Titel
        doc.setFontSize(14);
        doc.text(config.title || 'Hauspunkt – Ableseformular', marginL, 12);
        if (config.subtitle) {
            doc.setFontSize(9);
            doc.setTextColor(120);
            doc.text(config.subtitle, marginL, 18);
            doc.setTextColor(0);
        }
        doc.setFontSize(8);
        doc.text('Datum: _______________', pageW - marginR, 12, { align: 'right' });

        let y = config.subtitle ? 24 : 18;

        // Tabelle mit Eingabefeldern zeichnen
        const colWidths = config.colWidths || [];
        const totalDefined = colWidths.reduce((s, w) => s + w, 0);
        const scale = usableW / (totalDefined || usableW);
        const scaledWidths = colWidths.map(w => w * scale);

        const rowH = config.rowHeight || 7;
        const headerH = 6;

        // Header
        doc.setFillColor(240, 240, 240);
        let x = marginL;
        config.head.forEach((h, i) => {
            const w = scaledWidths[i] || 20;
            doc.rect(x, y, w, headerH, 'FD');
            doc.setFontSize(7);
            doc.setFont(undefined, 'bold');
            doc.text(String(h), x + 1.5, y + 4);
            x += w;
        });
        y += headerH;

        // Zeilen
        doc.setFont(undefined, 'normal');
        config.rows.forEach((row, ri) => {
            if (y + rowH > pageH - 15) {
                doc.addPage();
                y = 12;
                // Header wiederholen
                doc.setFillColor(240, 240, 240);
                x = marginL;
                config.head.forEach((h, i) => {
                    const w = scaledWidths[i] || 20;
                    doc.rect(x, y, w, headerH, 'FD');
                    doc.setFontSize(7);
                    doc.setFont(undefined, 'bold');
                    doc.text(String(h), x + 1.5, y + 4);
                    x += w;
                });
                y += headerH;
                doc.setFont(undefined, 'normal');
            }

            x = marginL;
            const isGroup = row._group;
            if (isGroup) {
                // Gruppenheader
                doc.setFillColor(248, 248, 248);
                doc.rect(x, y, usableW, rowH, 'FD');
                doc.setFontSize(8);
                doc.setFont(undefined, 'bold');
                doc.setTextColor(100);
                doc.text(String(row._group), x + 2, y + 5);
                doc.setTextColor(0);
                doc.setFont(undefined, 'normal');
                y += rowH;
                return;
            }

            row.cells.forEach((cell, ci) => {
                const w = scaledWidths[ci] || 20;
                doc.setDrawColor(200, 200, 200);
                doc.rect(x, y, w, rowH);
                if (cell.editable) {
                    // Eingabefeld: leicht grau hinterlegt mit Trennlinie
                    doc.setFillColor(255, 255, 250);
                    doc.rect(x + 0.5, y + 0.5, w - 1, rowH - 1, 'F');
                    // Unterstreichung als Schreibhilfe
                    doc.setDrawColor(180, 180, 180);
                    doc.setLineWidth(0.2);
                    doc.line(x + 1.5, y + rowH - 1.5, x + w - 1.5, y + rowH - 1.5);
                    if (cell.value) {
                        doc.setFontSize(8);
                        doc.text(String(cell.value), x + 1.5, y + 5);
                    }
                } else {
                    doc.setFontSize(7);
                    doc.text(String(cell.value || ''), x + 1.5, y + 5);
                }
                x += w;
            });
            y += rowH;
        });

        // Unterschriftsfeld
        y += 10;
        if (y > pageH - 30) { doc.addPage(); y = 20; }
        doc.setDrawColor(150);
        doc.setLineWidth(0.3);
        doc.line(marginL, y + 8, marginL + 60, y + 8);
        doc.setFontSize(7);
        doc.setTextColor(120);
        doc.text('Datum / Unterschrift', marginL, y + 12);

        doc.save(config.filename || 'formular.pdf');
    },

    // ── PDF mit echten AcroForm-Feldern (pdf-lib) ─────────────
    async exportPDFFormFillable(config) {
        if (typeof PDFLib === 'undefined') { alert('PDF-Lib nicht geladen.'); return; }
        const { PDFDocument, PDFTextField, rgb, StandardFonts } = PDFLib;
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
        const form = doc.getForm();

        const pageOpts = config.orientation === 'landscape'
            ? { size: [841.89, 595.28] } // A4 landscape in points
            : { size: [595.28, 841.89] }; // A4 portrait in points

        const marginL = 30;
        const marginR = 30;
        const marginTop = 40;
        const marginBottom = 40;
        let page = doc.addPage([pageOpts.size[0], pageOpts.size[1]]);
        const pageW = page.getWidth();
        const pageH = page.getHeight();
        const usableW = pageW - marginL - marginR;

        // Titel
        page.drawText(config.title || 'Hauspunkt', { x: marginL, y: pageH - 30, size: 14, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
        if (config.subtitle) {
            page.drawText(config.subtitle, { x: marginL, y: pageH - 44, size: 8, font: font, color: rgb(0.4, 0.4, 0.4) });
        }
        // Datum rechts
        const dateStr = 'Erstellt: ' + new Date().toLocaleDateString('de-DE');
        page.drawText(dateStr, { x: pageW - marginR - font.widthOfTextAtSize(dateStr, 7), y: pageH - 30, size: 7, font: font, color: rgb(0.5, 0.5, 0.5) });

        // Datum-Feld
        const datumField = form.createTextField('hp_datum');
        datumField.setText(config.datumValue || '');
        datumField.addToPage(page, { x: pageW - marginR - 80, y: pageH - 50, width: 80, height: 14, borderWidth: 0.5, backgroundColor: rgb(1, 1, 0.96) });

        page.drawText('Datum:', { x: pageW - marginR - 110, y: pageH - 45, size: 8, font: font });

        let y = pageH - (config.subtitle ? 60 : 52);

        // Spaltenbreiten berechnen
        const colWidths = config.colWidths || [];
        const totalDefined = colWidths.reduce((s, w) => s + w, 0);
        const scale = usableW / (totalDefined || usableW);
        const scaledWidths = colWidths.map(w => w * scale);
        const rowH = 18;
        const headerH = 16;

        function drawHeader(pg, yPos) {
            let xPos = marginL;
            config.head.forEach((h, i) => {
                const w = scaledWidths[i] || 40;
                pg.drawRectangle({ x: xPos, y: yPos - headerH, width: w, height: headerH, borderWidth: 0.3, borderColor: rgb(0.7, 0.7, 0.7), color: rgb(0.94, 0.94, 0.94) });
                pg.drawText(String(h), { x: xPos + 3, y: yPos - 11, size: 7, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
                xPos += w;
            });
            return yPos - headerH;
        }

        y = drawHeader(page, y);

        let fieldIdx = 0;
        config.rows.forEach((row) => {
            if (y - rowH < marginBottom) {
                page = doc.addPage([pageOpts.size[0], pageOpts.size[1]]);
                y = pageH - marginTop;
                y = drawHeader(page, y);
            }

            if (row._group) {
                // Gruppenzeile
                page.drawRectangle({ x: marginL, y: y - rowH, width: usableW, height: rowH, color: rgb(0.97, 0.97, 0.97) });
                page.drawText(String(row._group), { x: marginL + 4, y: y - 13, size: 8, font: fontBold, color: rgb(0.4, 0.4, 0.4) });
                y -= rowH;
                return;
            }

            let xPos = marginL;
            row.cells.forEach((cell, ci) => {
                const w = scaledWidths[ci] || 40;
                page.drawRectangle({ x: xPos, y: y - rowH, width: w, height: rowH, borderWidth: 0.2, borderColor: rgb(0.8, 0.8, 0.8) });

                if (cell.editable) {
                    // Echtes Formularfeld
                    const fieldName = 'hp_val_' + fieldIdx + '_' + (cell.fieldId || ci);
                    const tf = form.createTextField(fieldName);
                    if (cell.value) tf.setText(String(cell.value));
                    tf.addToPage(page, {
                        x: xPos + 2, y: y - rowH + 2,
                        width: w - 4, height: rowH - 4,
                        borderWidth: 0.3,
                        backgroundColor: rgb(1, 1, 0.96),
                    });
                } else {
                    page.drawText(String(cell.value || ''), { x: xPos + 3, y: y - 13, size: 7, font: font });
                }
                xPos += w;
            });
            fieldIdx++;
            y -= rowH;
        });

        // Metadaten als verstecktes Feld für Re-Import
        const metaField = form.createTextField('hp_meta');
        metaField.setText(JSON.stringify(config.meta || {}));
        // Verstecktes Feld (außerhalb der sichtbaren Seite)
        metaField.addToPage(doc.getPages()[0], { x: -200, y: -200, width: 1, height: 1 });

        const bytes = await doc.save();
        const blob = new Blob([bytes], { type: 'application/pdf' });
        HPExport._download(blob, config.filename || 'formular.pdf');
    },

    // ── PDF Formular importieren (AcroForm-Felder lesen) ─────────
    async parsePDFForm(arrayBuffer) {
        if (typeof PDFLib === 'undefined') { alert('PDF-Lib nicht geladen.'); return null; }
        const { PDFDocument } = PDFLib;
        const doc = await PDFDocument.load(arrayBuffer);
        const form = doc.getForm();
        const fields = form.getFields();

        const result = { meta: {}, values: {} };
        fields.forEach(field => {
            const name = field.getName();
            let value = '';
            try {
                if (field.constructor.name === 'PDFTextField' || typeof field.getText === 'function') {
                    value = field.getText() || '';
                }
            } catch (e) { /* skip */ }

            if (name === 'hp_meta') {
                try { result.meta = JSON.parse(value); } catch (e) { /* skip */ }
            } else if (name === 'hp_datum') {
                result.datum = value;
            } else if (name.startsWith('hp_val_')) {
                result.values[name] = value;
            }
        });
        return result;
    },

    // ── Datei-Upload Dialog ──────────────────────────────────────
    promptFileUpload(accept, callback) {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = accept;
        inp.style.display = 'none';
        inp.addEventListener('change', () => {
            if (inp.files.length) callback(inp.files[0]);
            inp.remove();
        });
        document.body.appendChild(inp);
        inp.click();
    },

    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
            r.readAsText(file, 'UTF-8');
        });
    },

    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
            r.readAsArrayBuffer(file);
        });
    },

    // ── Download-Helfer ──────────────────────────────────────────
    _download(blob, filename) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    },

    // ── Dropdown-Menü ────────────────────────────────────────────
    createExportMenu(btnEl, items) {
        // items: [{ label, icon, onClick }]
        let menu = btnEl._hpMenu;
        if (menu) { menu.remove(); btnEl._hpMenu = null; return; }

        menu = document.createElement('div');
        menu.className = 'hp-export-menu';
        items.forEach(item => {
            if (item.separator) {
                const sep = document.createElement('div');
                sep.className = 'hp-menu-sep';
                menu.appendChild(sep);
                return;
            }
            const a = document.createElement('div');
            a.className = 'hp-menu-item';
            a.innerHTML = (item.icon ? '<span class="hp-menu-icon">' + item.icon + '</span>' : '') + item.label;
            a.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.remove();
                btnEl._hpMenu = null;
                item.onClick();
            });
            menu.appendChild(a);
        });
        btnEl._hpMenu = menu;
        btnEl.style.position = 'relative';
        btnEl.appendChild(menu);

        // Schließen bei Klick außerhalb
        setTimeout(() => {
            const close = (e) => {
                if (!menu.contains(e.target) && e.target !== btnEl) {
                    menu.remove();
                    btnEl._hpMenu = null;
                    document.removeEventListener('click', close);
                }
            };
            document.addEventListener('click', close);
        }, 10);
    }
};
