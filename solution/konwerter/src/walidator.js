/*
 * Walidator plików z danymi o defibrylatorach AED, standard aed-pl 2.0 (krajowa lista: 4 pola wymagane).
 * Reguły pól wynikają z opisu w standardzie (type, pattern, min/max, minLength, maxLength, softMaxLength, unique, expiry, notFuture, verified).
 * Bez zależności. Działa w przeglądarce (globalny AedWalidator) i w Node (require).
 */
(function (root) {
  'use strict';

  var PL_BBOX = { latMin: 49.0, latMax: 54.9, lonMin: 14.1, lonMax: 24.2 };

  var HEADER_ALIASES = {
    id: 'aed_id', latitude: 'lat', lng: 'lon', longitude: 'lon', nazwa: 'name', telefon: 'contact_phone', phone: 'contact_phone'
  };

  // ---------- tekst i CSV ----------

  function stripDiacritics(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');
  }

  function normalizeHeader(h) {
    return stripDiacritics(String(h).replace(/^﻿/, '').trim().toLowerCase())
      .replace(/[\s\-./]+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  /** Dekoduje bajty pliku: UTF-8, a gdy się nie da, Windows-1250 (typowy eksport z polskiego Excela). */
  function decodeBytes(bytes) {
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''), encoding: 'UTF-8' };
    } catch (e) {
      return { text: new TextDecoder('windows-1250').decode(bytes), encoding: 'Windows-1250' };
    }
  }

  function detectDelimiter(text) {
    var firstLine = text.split(/\r?\n/, 1)[0] || '';
    var best = ',', bestCount = -1;
    [',', ';', '\t'].forEach(function (d) {
      var n = firstLine.split(d).length - 1;
      if (n > bestCount) { best = d; bestCount = n; }
    });
    return best;
  }

  /** Parser CSV zgodny z RFC 4180 (cudzysłowy, znaki nowej linii w polach). */
  function parseCsv(text, delimiter) {
    var d = delimiter || detectDelimiter(text);
    var rows = [], row = [], field = '', i = 0, inQuotes = false, c;
    while (i < text.length) {
      c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { inQuotes = true; i++; continue; }
      if (c === d) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (v) { return v.trim() !== ''; }); });
    return { delimiter: d, rows: rows };
  }

  function csvEscape(v) {
    var s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ---------- sprawdzanie wartości ----------

  function isValidIsoDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number), dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return dt.getUTCFullYear() === p[0] && dt.getUTCMonth() === p[1] - 1 && dt.getUTCDate() === p[2];
  }

  function checksumOk(digits, weights, mod) {
    var sum = 0;
    for (var i = 0; i < weights.length; i++) sum += Number(digits[i]) * weights[i];
    var c = sum % mod; if (c === 10) c = 0;
    return c === Number(digits[weights.length]);
  }

  function regonOk(s) {
    if (/^0+$/.test(s)) return false;
    if (/^\d{9}$/.test(s)) return checksumOk(s, [8, 9, 2, 3, 4, 5, 6, 7], 11);
    if (/^\d{14}$/.test(s)) return checksumOk(s, [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8], 11);
    return false;
  }

  function nipOk(s) {
    if (!/^\d{10}$/.test(s)) return false;
    var sum = 0, w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
    for (var i = 0; i < 9; i++) sum += Number(s[i]) * w[i];
    return sum % 11 !== 10 && sum % 11 === Number(s[9]);
  }

  var OH_DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)';
  var OH_DAYS = OH_DAY + '(?:-' + OH_DAY + ')?(?:,' + OH_DAY + '(?:-' + OH_DAY + ')?)*';
  var OH_TIME = '(?:[01]?\\d|2[0-4]):[0-5]\\d';
  var OH_TIMES = OH_TIME + '-' + OH_TIME + '\\+?(?:,' + OH_TIME + '-' + OH_TIME + '\\+?)*';
  var OH_RULE = new RegExp('^(?:' + OH_DAYS + ')?\\s*(?:' + OH_TIMES + '|off|closed)$|^' + OH_DAYS + '$');

  function openingHoursOk(s) {
    if (s === '24/7') return true;
    return s.split(/\s*;\s*|\s*\|\|\s*/).every(function (rule) { return OH_RULE.test(rule.trim()); });
  }

  function looksPolishHours(s) {
    return /\b(pn|pon|wt|śr|sr|czw|pt|pi[aą]t|sob|niedz|nd|godz)/i.test(s);
  }

  function todayIso(opt) {
    if (opt && opt.today) return opt.today;
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function addMonths(iso, months) {
    var p = iso.split('-').map(Number), dt = new Date(Date.UTC(p[0], p[1] - 1 + months, p[2]));
    return dt.toISOString().slice(0, 10);
  }

  function parseBool(standard, v) {
    var b = standard.file.boolean_values, s = v.trim().toLowerCase();
    if (b['true'].indexOf(s) >= 0) return true;
    if (b['false'].indexOf(s) >= 0) return false;
    return null;
  }

  function findEnum(field, v) {
    var s = v.trim().toLowerCase(), plain = stripDiacritics(s).replace(/[\s-]+/g, '_');
    for (var i = 0; i < field.enum.length; i++) {
      var e = field.enum[i];
      if (e.code.toLowerCase() === s) return { item: e, exact: true };
    }
    for (var j = 0; j < field.enum.length; j++) {
      var o = field.enum[j];
      if (o.code.toLowerCase() === plain || (o.db && String(o.db).toLowerCase() === s) || o.label.toLowerCase() === s) {
        return { item: o, exact: false };
      }
    }
    return null;
  }

  /**
   * Sprawdza jedną wartość. Zwraca { value, issues } gdzie value to wartość znormalizowana
   * (string w pliku CSV) albo undefined, gdy pole puste.
   */
  function checkValue(standard, field, raw, ctx) {
    var issues = [], v = raw == null ? '' : String(raw).trim();
    function err(m) { issues.push({ severity: 'error', field: field.name, message: m }); }
    function warn(m) { issues.push({ severity: 'warning', field: field.name, message: m }); }
    function info(m) { issues.push({ severity: 'info', field: field.name, message: m }); }

    if (v === '') return { value: undefined, issues: issues };
    if (field.maxLength && v.length > field.maxLength) err('Za długi tekst: ' + v.length + ' znaków, limit to ' + field.maxLength + '.');
    else if (field.softMaxLength && v.length > field.softMaxLength) warn('Opis ma ' + v.length + ' znaków. Do OpenStreetMap i aplikacji ratunkowych trafi tylko pierwsze ' + field.softMaxLength + ', więc najważniejsze napisz na początku.');
    if (field.minLength && v.length < field.minLength) err('Za krótki tekst: potrzeba co najmniej ' + field.minLength + ' znaków.');

    switch (field.type) {
      case 'number': {
        var n = v;
        if (/^-?\d+,\d+$/.test(n)) { n = n.replace(',', '.'); info('Zamieniono przecinek na kropkę w liczbie.'); }
        if (!/^-?\d+(\.\d+)?$/.test(n)) { err('To nie jest liczba: „' + v + '”. Użyj formatu 52.229676.'); break; }
        var num = Number(n);
        if (num < field.min || num > field.max) err('Wartość ' + n + ' leży poza Polską (dozwolony zakres ' + field.min + '–' + field.max + ').');
        var dec = (n.split('.')[1] || '').length;
        if (dec < 5) warn('Tylko ' + dec + (dec === 1 ? ' miejsce' : dec >= 2 && dec <= 4 ? ' miejsca' : ' miejsc') + ' po przecinku. Podaj co najmniej 5, żeby punkt wskazywał budynek, a nie okolicę.');
        v = n;
        break;
      }
      case 'boolean': {
        var b = parseBool(standard, v);
        if (b === null) err('Wpisz „tak” albo „nie” (jest: „' + v + '”).');
        else v = b ? 'tak' : 'nie';
        break;
      }
      case 'enum': {
        var found = findEnum(field, v);
        if (!found) err('Niedozwolona wartość „' + v + '”. Dozwolone: ' + field.enum.map(function (e) { return e.code; }).join(', ') + '.');
        else { if (!found.exact) info('Zamieniono „' + v + '” na kod „' + found.item.code + '”.'); v = found.item.code; }
        break;
      }
      case 'date': {
        var m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/.exec(v);
        if (m) {
          var iso = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
          if (isValidIsoDate(iso)) { warn('Data w formacie „' + v + '” zamieniona na ' + iso + '. Używaj formatu RRRR-MM-DD.'); v = iso; }
        }
        if (!isValidIsoDate(v)) { err('Nieprawidłowa data „' + v + '”. Użyj formatu RRRR-MM-DD, np. 2026-11-15.'); break; }
        var today = ctx.today;
        if (field.notFuture && v > today) err('Ta data nie może być w przyszłości.');
        else if (field.verified && v < addMonths(today, -12)) warn('Dane sprawdzono ponad rok temu. Zweryfikuj AED na miejscu i zaktualizuj datę.');
        if (field.expiry && v < today) warn('Termin ważności minął ' + v + '. Wymień ' + (/battery|bateri/.test(field.name) ? 'baterię' : 'elektrody') + ' albo ustaw stan „czasowo niesprawny”.');
        break;
      }
      case 'opening_hours': {
        if (/^(24\/7|24h|całodobowo|calodobowo|całą dobę)$/i.test(v)) { if (v !== '24/7') info('Zamieniono „' + v + '” na 24/7.'); v = '24/7'; break; }
        if (!openingHoursOk(v)) {
          if (looksPolishHours(v)) err('Godziny zapisano po polsku („' + v + '”). Użyj skrótów OSM, np. Mo-Fr 07:00-19:00; Sa 08:00-14:00.');
          else err('Nie rozpoznano godzin „' + v + '”. Przykład poprawnego zapisu: Mo-Fr 07:00-19:00; Sa 08:00-14:00.');
        }
        break;
      }
      case 'phone': {
        var digits = v.replace(/[\s\-()]/g, '');
        if (!/^(\+\d{8,15}|\d{9})$/.test(digits)) err('Nieprawidłowy numer telefonu „' + v + '”. Przykład: +48 12 616 12 00.');
        break;
      }
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) err('Nieprawidłowy adres e-mail „' + v + '”.');
        break;
      case 'url':
        if (!/^https?:\/\/[^\s]+\.[^\s]+$/.test(v)) err('Adres musi zaczynać się od https:// (jest: „' + v + '”).');
        break;
      case 'regon':
        v = v.replace(/[\s-]/g, '');
        if (!regonOk(v)) err('Nieprawidłowy REGON „' + v + '” (zła długość lub cyfra kontrolna).');
        break;
      case 'same_as': {
        var parts = v.split(/\s*;\s*/).filter(Boolean), bad = parts.filter(function (x) { return !/^((\d{9}|\d{14}):[A-Za-z0-9._:\/-]{1,64}|osm:(node|way)\/\d+)$/i.test(x); });
        if (bad.length) err('Nierozpoznane powiązanie „' + bad.join('; ') + '”. Użyj REGON:identyfikator (np. 000526989:5) albo osm:node/numer, kilka oddziel średnikiem.');
        else v = parts.join(';');
        break;
      }
      case 'nip':
        v = v.replace(/[\s-]/g, '').replace(/^PL/i, '');
        if (!nipOk(v)) err('Nieprawidłowy NIP „' + v + '” (zła długość lub cyfra kontrolna).');
        break;
      default:
        break;
    }
    if (field.pattern && !issues.some(function (i) { return i.severity === 'error'; }) && !new RegExp(field.pattern).test(v)) {
      var hint = field.example ? ' Przykład: ' + field.example + '.' : '';
      err('Nieprawidłowy format „' + v + '”.' + hint);
    }
    return { value: v, issues: issues };
  }

  /** Reguły dotyczące kilku pól naraz. */
  function checkRecord(rec, issues) {
    function add(sev, field, m) { issues.push({ severity: sev, field: field, message: m }); }
    var lat = Number(rec.lat), lon = Number(rec.lon);
    if (rec.lat !== undefined && rec.lon !== undefined &&
        lat >= PL_BBOX.lonMin && lat <= PL_BBOX.lonMax && lon >= PL_BBOX.latMin && lon <= PL_BBOX.latMax &&
        !(lat >= PL_BBOX.latMin && lat <= PL_BBOX.latMax && lon >= PL_BBOX.lonMin && lon <= PL_BBOX.lonMax)) {
      for (var k = issues.length - 1; k >= 0; k--) {
        if (/^(lat|lon)$/.test(issues[k].field || '') && /poza Polską/.test(issues[k].message)) issues.splice(k, 1);
      }
      add('error', 'lat', 'Współrzędne wyglądają na zamienione: szerokość w Polsce to 49–55, długość 14–24. Zamień kolumny miejscami.');
    }
    if (rec.is_24_7 === 'tak') {
      if (rec.opening_hours === undefined) { rec.opening_hours = '24/7'; add('info', 'opening_hours', 'Uzupełniono godziny na 24/7.'); }
      else if (rec.opening_hours !== '24/7') add('warning', 'opening_hours', 'AED oznaczono jako 24/7, ale godziny to „' + rec.opening_hours + '”. Sprawdź, które jest prawdą.');
    } else if (rec.is_24_7 === 'nie' && rec.opening_hours === '24/7') {
      add('error', 'is_24_7', 'Godziny to 24/7, a pole „dostępny 24/7” ma wartość „nie”.');
    } else if (rec.is_24_7 === undefined && rec.opening_hours !== undefined) {
      rec.is_24_7 = rec.opening_hours === '24/7' ? 'tak' : 'nie'; add('info', 'is_24_7', 'Uzupełniono „dostępny 24/7” na podstawie godzin.');
    }
    if (rec.cabinet_locked === 'nie' && rec.unlock_method !== undefined && rec.unlock_method !== 'none') add('warning', 'unlock_method', 'Szafka jest oznaczona jako otwarta, a sposób otwarcia to „' + rec.unlock_method + '”. Sprawdź.');
    if (rec.cabinet_locked === 'tak' && rec.unlock_method === 'none') add('warning', 'unlock_method', 'Szafka jest oznaczona jako zamknięta, a sposób otwarcia to „bez zabezpieczeń”. Sprawdź.');
    if (rec.placement !== undefined && rec.placement.length < 10) add('warning', 'placement', 'Opis miejsca jest bardzo krótki. Dodaj piętro i punkt orientacyjny.');
    if (rec.access === 'no' && rec.is_24_7 === 'tak') add('warning', 'access', 'AED jest niedostępny dla osób z zewnątrz, a jednocześnie oznaczony jako 24/7.');
    if (rec.status === 'removed') add('info', 'status', 'AED zostanie oznaczony jako zdjęty. Zostaw ten wiersz w pliku, żeby inni wiedzieli, że go już nie ma.');
  }

  /**
   * Waliduje cały plik.
   * input: tekst CSV albo { header: [], rows: [[]] }
   * Zwraca { delimiter, columns, fileIssues, records: [{ line, values, issues }], summary }
   */
  function validate(standard, input, opt) {
    opt = opt || {};
    var ctx = { today: todayIso(opt) };
    var parsed = typeof input === 'string' ? parseCsv(input, opt.delimiter) : { delimiter: ',', rows: [input.header].concat(input.rows) };
    var fileIssues = [], fieldsByName = {};
    standard.fields.forEach(function (f) { fieldsByName[f.name] = f; });

    if (!parsed.rows.length) {
      fileIssues.push({ severity: 'error', message: 'Plik jest pusty.' });
      return finish([], []);
    }

    var rawHeader = parsed.rows[0], columns = [], seen = {};
    rawHeader.forEach(function (h, idx) {
      var n = normalizeHeader(h), target = fieldsByName[n] ? n : HEADER_ALIASES[n];
      if (target && !fieldsByName[n]) fileIssues.push({ severity: 'info', message: 'Kolumnę „' + h + '” potraktowano jako „' + target + '”.' });
      if (!target) {
        if (h.trim() !== '') fileIssues.push({ severity: 'warning', message: 'Nieznana kolumna „' + h + '” zostanie pominięta.' });
        columns.push(null); return;
      }
      if (seen[target]) { fileIssues.push({ severity: 'error', message: 'Kolumna „' + target + '” występuje dwa razy.' }); columns.push(null); return; }
      seen[target] = true; columns.push(target);
    });
    standard.fields.forEach(function (f) {
      if (f.level === 'wymagane' && !seen[f.name]) {
        fileIssues.push({ severity: 'error', field: f.name, message: 'Brak wymaganej kolumny „' + f.name + '”.' });
      }
    });
    if (parsed.rows.length === 1) fileIssues.push({ severity: 'error', message: 'Plik ma tylko nagłówek, bez żadnego AED.' });

    var records = parsed.rows.slice(1).map(function (cells, i) {
      var values = {}, issues = [];
      if (cells.length > rawHeader.length) issues.push({ severity: 'error', message: 'Wiersz ma ' + cells.length + ' pól, a nagłówek ' + rawHeader.length + '. Sprawdź cudzysłowy i separator.' });
      columns.forEach(function (name, idx) {
        if (!name) return;
        var r = checkValue(standard, fieldsByName[name], cells[idx], ctx);
        if (r.value !== undefined) values[name] = r.value;
        issues = issues.concat(r.issues);
      });
      standard.fields.forEach(function (f) {
        if (f.level === 'wymagane' && seen[f.name] && values[f.name] === undefined) {
          issues.push({ severity: 'error', field: f.name, message: 'Puste pole wymagane: ' + f.label + '.' });
        }
      });
      checkRecord(values, issues);
      return { line: i + 2, values: values, issues: issues };
    });

    // reguły między wierszami: unikalny klucz i ta sama tożsamość urządzenia
    var uniq = standard.fields.filter(function (f) { return f.unique; }).map(function (f) { return f.name; });
    var idents = (standard.merge && standard.merge.identity) || [];
    var seenU = {}, seenD = {};
    records.forEach(function (r) {
      uniq.forEach(function (n) {
        var v = r.values[n]; if (v === undefined) return;
        seenU[n] = seenU[n] || {};
        if (seenU[n][v]) r.issues.push({ severity: 'error', field: n, message: 'Identyfikator „' + v + '” powtarza się (pierwszy raz w wierszu ' + seenU[n][v] + '). Każde urządzenie musi mieć inny.' });
        else seenU[n][v] = r.line;
      });
      var dupDone = false;
      for (var k = 0; k < idents.length; k++) {
        var parts = idents[k].map(function (n) { return r.values[n]; });
        if (parts.some(function (x) { return x === undefined; })) continue;
        var key = k + ':' + parts.join('|').toUpperCase().replace(/\s/g, '');
        if (seenD[key]) {
          if (!dupDone) r.issues.push({ severity: 'error', field: idents[k][idents[k].length - 1], message: 'To samo urządzenie (' + idents[k].join(' + ') + ') jest już w wierszu ' + seenD[key] + '. Jedno urządzenie to jeden wiersz.' });
          dupDone = true;
        } else seenD[key] = r.line;
      }
    });

    return finish(records, columns);

    function finish(recs, cols) {
      var s = { rows: recs.length, valid: 0, withErrors: 0, errors: 0, warnings: 0, fileErrors: 0, recommendedFilled: 0, recommendedTotal: 0 };
      var rec = standard.fields.filter(function (f) { return f.level === 'zalecane'; });
      recs.forEach(function (r) {
        var e = r.issues.filter(function (x) { return x.severity === 'error'; }).length;
        s.errors += e; s.warnings += r.issues.filter(function (x) { return x.severity === 'warning'; }).length;
        if (e) s.withErrors++; else s.valid++;
        rec.forEach(function (f) { s.recommendedTotal++; if (r.values[f.name] !== undefined) s.recommendedFilled++; });
      });
      s.fileErrors = fileIssues.filter(function (x) { return x.severity === 'error'; }).length;
      s.ready = s.fileErrors === 0 && s.withErrors === 0 && s.rows > 0;
      return { delimiter: parsed.delimiter, columns: cols, fileIssues: fileIssues, records: recs, summary: s, today: ctx.today };
    }
  }

  // ---------- eksport ----------

  function toCsv(standard, records) {
    var names = standard.fields.map(function (f) { return f.name; });
    var lines = [names.join(',')];
    records.forEach(function (r) { lines.push(names.map(function (n) { return csvEscape(r.values[n]); }).join(',')); });
    return lines.join('\r\n') + '\r\n';
  }

  function typed(standard, values) {
    var out = {};
    standard.fields.forEach(function (f) {
      var v = values[f.name];
      if (v === undefined) { out[f.name] = null; return; }
      if (f.type === 'number') out[f.name] = Number(v);
      else if (f.type === 'boolean') out[f.name] = v === 'tak';
      else out[f.name] = v;
    });
    return out;
  }

  function toJson(standard, records, meta) {
    return JSON.stringify({
      standard: standard.id, wersja: standard.version, wygenerowano: new Date().toISOString(),
      dysponent: meta && meta.dysponent || null,
      liczba_rekordow: records.length,
      rekordy: records.map(function (r) { return typed(standard, r.values); })
    }, null, 2) + '\n';
  }

  /** Rekord w postaci gotowej dla integratora (kody bazy danych zamiast kodów standardu). */
  function toDbValues(standard, values) {
    var out = typed(standard, values);
    standard.fields.forEach(function (f) {
      if (f.type === 'enum' && out[f.name] != null) {
        var e = f.enum.filter(function (x) { return x.code === out[f.name]; })[0];
        out[f.name] = e ? e.db : null;
      }
    });
    return out;
  }

  var api = {
    parseCsv: parseCsv, decodeBytes: decodeBytes, normalizeHeader: normalizeHeader, validate: validate,
    checkValue: checkValue, toCsv: toCsv, toJson: toJson, toDbValues: toDbValues, csvEscape: csvEscape,
    regonOk: regonOk, nipOk: nipOk, openingHoursOk: openingHoursOk
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AedWalidator = api;
})(this);
