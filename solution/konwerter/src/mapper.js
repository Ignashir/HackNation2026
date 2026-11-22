/*
 * Konwerter AEDane: wczytywanie plików dysponentów (CSV, XLSX, JSON, GeoJSON), dopasowanie kolumn
 * do standardu aed-pl, przekształcenia wartości i budowa wierszy dla walidatora.
 * Bez zależności. Działa w przeglądarce (globalny AedMapper) i w Node 18+ (require).
 * Wymaga walidatora (AedWalidator) tylko do sprawdzania wartości słownikowych.
 */
(function (root) {
  'use strict';

  // ---------- normalizacja tekstu ----------

  function stripDiacritics(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');
  }
  function norm(h) {
    return stripDiacritics(String(h).replace(/^﻿/, '').trim().replace(/([a-ząćęłńóśźż])([A-ZĄĆĘŁŃÓŚŹŻ])/g, '$1_$2').toLowerCase())
      .replace(/[\s\-./:,;()\[\]#]+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }
  var PREFIXES = /^(tags|properties|attributes|atrybuty|addr|address|adres|aed|pole|kolumna)_/;
  function variants(h) {
    var n = norm(h), out = [n], m;
    while ((m = PREFIXES.exec(out[out.length - 1])) && out[out.length - 1].length > m[0].length) out.push(out[out.length - 1].slice(m[0].length));
    return out;
  }

  // ---------- synonimy nazw kolumn (postać po norm()) ----------

  // Każde pole ma też dawną polską nazwę ze standardu 1.0, żeby stare pliki dopasowały się same.
  var SYN = {
    aed_id: ['id_aed', 'id', 'identyfikator', 'nr_aed', 'numer_aed', 'kod_aed', 'id_urzadzenia', 'numer_ewidencyjny', 'nr_ewidencyjny', 'nr_ewid', 'nr_inwentarzowy', 'ref', 'external_id', 'sygnatura'],
    name: ['nazwa_miejsca', 'nazwa', 'nazwa_obiektu', 'obiekt', 'miejsce', 'placowka', 'nazwa_placowki', 'budynek', 'nazwa_budynku', 'lokal', 'nazwa_lokalizacji'],
    lat: ['szerokosc_geograficzna', 'latitude', 'szerokosc', 'szer', 'szer_geogr', 'szerokosc_geogr', 'y', 'wsp_y', 'wspolrzedna_y', 'n', 'geometry_lat'],
    lon: ['dlugosc_geograficzna', 'lng', 'long', 'longitude', 'dlugosc', 'dl', 'dl_geogr', 'dlugosc_geogr', 'x', 'wsp_x', 'wspolrzedna_x', 'e', 'geometry_lon'],
    address: ['adres', 'adres_pelny', 'pelny_adres', 'adres_obiektu', 'adres_lokalizacji', 'lokalizacja_adres', 'adres_aed', 'full_address'],
    city: ['miejscowosc', 'miasto', 'town', 'msc', 'miejsc', 'locality'],
    street: ['ulica', 'ul', 'adres_ulica', 'ulica_plac'],
    house_number: ['numer_budynku', 'nr', 'numer', 'nr_domu', 'numer_domu', 'nr_budynku', 'housenumber', 'numer_posesji', 'nr_posesji'],
    postcode: ['kod_pocztowy', 'kod', 'kod_poczt', 'kod_p', 'postal_code', 'zip', 'zip_code'],
    teryt: ['kod_teryt_simc', 'teryt_terc', 'terc', 'kod_teryt', 'kod_terc', 'simc'],
    placement: ['opis_lokalizacji', 'opis', 'gdzie', 'dokladne_miejsce', 'umiejscowienie', 'lokalizacja', 'miejsce_zawieszenia', 'lokalizacja_w_budynku', 'description', 'opis_miejsca', 'gdzie_wisi', 'gdzie_dokladnie', 'miejsce_montazu', 'lokalizacja_aed', 'defibrillator_location', 'opis_polozenia'],
    indoor: ['wewnatrz_budynku', 'wewnatrz', 'w_budynku', 'wewnatrz_zewnatrz', 'wewnatrz_na_zewnatrz', 'umieszczenie', 'wewn_zewn', 'w_srodku'],
    floor: ['pietro', 'kondygnacja', 'level', 'poziom'],
    access: ['dostep', 'dostepnosc', 'rodzaj_dostepu', 'dostepny_dla', 'typ_dostepu', 'kto_ma_dostep'],
    is_24_7: ['dostepny_24_7', '24_7', '24h', 'calodobowy', 'calodobowo', 'dostepny_calodobowo', 'czy_24h', 'calodobowa', 'czy_calodobowo', 'dostepnosc_24h', 'calodobowy_dostep'],
    opening_hours: ['godziny_dostepnosci', 'godziny', 'godziny_otwarcia', 'dostepny_w_godzinach', 'godz', 'godziny_dostepu', 'godziny_pracy', 'kiedy_dostepny'],
    cabinet_locked: ['szafka_zamknieta', 'zamknieta', 'zamkniety', 'locked', 'czy_zamknieta', 'zabezpieczona', 'blokada'],
    unlock_method: ['sposob_odblokowania', 'odblokowanie', 'zabezpieczenie', 'kod_dostepu', 'jak_otworzyc', 'sposob_otwarcia'],
    status: ['stan', 'sprawnosc', 'stan_urzadzenia', 'stan_techniczny', 'czy_sprawny', 'status_urzadzenia'],
    manufacturer: ['producent', 'marka', 'brand', 'wytworca', 'producent_aed'],
    model: ['typ_urzadzenia', 'typ_aed', 'model_aed', 'model_urzadzenia'],
    serial_number: ['numer_seryjny', 'nr_seryjny', 'sn', 'serial', 's_n', 'nr_fabryczny', 'numer_fabryczny', 'nr_ser'],
    udi_di: ['udi', 'udi_di', 'kod_udi', 'gtin', 'di'],
    paediatric_capable: ['elektrody_dzieciece', 'elektrody_pediatryczne', 'pediatryczne', 'dla_dzieci', 'elektrody_dla_dzieci', 'tryb_pediatryczny', 'pediatric'],
    pads_expiry: ['data_waznosci_elektrod', 'elektrody', 'waznosc_elektrod', 'termin_elektrod', 'elektrody_do', 'elektrody_wazne_do', 'termin_waznosci_elektrod', 'data_elektrod', 'electrodes_expiry'],
    battery_expiry: ['data_waznosci_baterii', 'bateria', 'waznosc_baterii', 'termin_baterii', 'bateria_do', 'bateria_wazna_do', 'termin_waznosci_baterii', 'data_baterii'],
    last_verified: ['data_weryfikacji', 'weryfikacja', 'sprawdzono', 'data_sprawdzenia', 'data_aktualizacji', 'aktualizacja', 'check_date', 'zweryfikowano', 'survey_date', 'data_weryf', 'ostatnia_weryfikacja', 'verified'],
    operator: ['dysponent', 'dysponent_nazwa', 'zarzadca', 'jednostka', 'instytucja', 'podmiot', 'opiekun', 'nazwa_jednostki', 'nazwa_dysponenta', 'jednostka_odpowiedzialna'],
    contact_phone: ['kontakt_telefon', 'telefon', 'tel', 'phone', 'nr_telefonu', 'telefon_kontaktowy', 'tel_kontaktowy', 'kontakt', 'numer_telefonu'],
    notes: ['uwagi', 'notatki', 'komentarz', 'note', 'informacje_dodatkowe', 'dodatkowe_informacje', 'opis_dodatkowy', 'uwagi_wewnetrzne'],
    same_as: ['to_samo_co', 'powiazanie', 'powiazania', 'osm_id', 'osm', 'id_osm', 'sameas']
  };
  var ADDRESS_SYN = ['adres', 'address', 'adres_pelny', 'pelny_adres', 'adres_obiektu', 'adres_lokalizacji', 'lokalizacja_adres', 'adres_aed', 'full_address'];
  var COORD_SYN = ['wspolrzedne', 'wspolrzedne_gps', 'gps', 'polozenie', 'coordinates', 'coords', 'geo', 'geolokalizacja', 'lokalizacja_gps', 'punkt', 'wkt', 'geometry', 'wsp'];

  // ---------- rozpoznawanie zawartości kolumny ----------

  function num(v) {
    var s = String(v).trim().replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }
  var DETECT = {
    lat: function (v) { var n = num(v); return n >= 49 && n <= 55; },
    lon: function (v) { var n = num(v); return n >= 14 && n <= 24.2; },
    postcode: function (v) { return /^\d{2}-\d{3}$/.test(String(v).trim()); },
    teryt: function (v) { return /^\d{7}$/.test(String(v).trim()); },
    contact_phone: function (v) { var d = String(v).replace(/[\s\-()]/g, ''); return /^(\+48)?\d{9}$/.test(d); },
    opening_hours: function (v) { return /^(24\/7|(Mo|Tu|We|Th|Fr|Sa|Su|pn|pon|wt|sr|śr|czw|pt|sob|nd|niedz)\b.*\d{1,2}(:\d{2})?\s*-\s*\d{1,2})/i.test(String(v).trim()); },
    udi_di: function (v) { return /^\d{14}$/.test(String(v).trim()); },
    same_as: function (v) { return /^((\d{9}|\d{14}):\S+|osm:node\/\d+)(;|$)/i.test(String(v).trim()); }
  };
  var DATE_LIKE = function (v) { var s = String(v).trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}[.\/]\d{1,2}[.\/]\d{4}$/.test(s); };
  var ADDR_LIKE = function (v) { var s = String(v); return /\d{2}-\d{3}/.test(s) && /[a-ząćęłńóśźż]{3,}/i.test(s) && /\d+[a-z]?\b/i.test(s.replace(/\d{2}-\d{3}/, '')); };
  var COORD_LIKE = function (v) { return parseCoords(v) !== null; };

  function share(values, fn) {
    if (!values.length) return 0;
    var ok = 0; values.forEach(function (v) { if (fn(v)) ok++; });
    return ok / values.length;
  }

  function columnSample(rows, idx, max) {
    var out = [];
    for (var i = 0; i < rows.length && out.length < (max || 200); i++) {
      var v = rows[i][idx];
      if (v != null && String(v).trim() !== '') out.push(String(v).trim());
    }
    return out;
  }

  // ---------- podobieństwo nazw ----------

  function lev(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length, prev = [], cur, i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function sim(a, b) { var l = Math.max(a.length, b.length); return l ? 1 - lev(a, b) / l : 0; }

  /** Ocena dopasowania nazwy kolumny do pola: { score 0..1, why }. */
  function nameScore(header, field) {
    var vs = variants(header), names = [field.name].concat(SYN[field.name] || []), best = { score: 0, why: '' };
    function take(s, why) { if (s > best.score) best = { score: s, why: why }; }
    vs.forEach(function (v, vi) {
      var penalty = vi ? 0.03 : 0;
      names.forEach(function (n, ni) {
        if (v === n) take((ni === 0 ? 1 : 0.95) - penalty, ni === 0 ? 'nazwa ze standardu' : 'znana nazwa kolumny');
        else {
          var vt = v.split('_'), nt = n.split('_');
          if (n.length >= 3 && nt.every(function (t) { return vt.indexOf(t) >= 0; })) take(0.72 + 0.18 * (nt.length / vt.length) - penalty, 'nazwa zawiera „' + n.replace(/_/g, ' ') + '”');
          else if (v.length >= 4 && n.length >= 4) { var s = sim(v, n); if (s >= 0.75) take(0.7 * s - penalty, 'podobna nazwa'); }
        }
      });
    });
    return best;
  }

  /**
   * Propozycja mapowania: dla każdego pola standardu wybiera kolumnę pliku (lub przekształcenie kolumny).
   * Zwraca { fields: { name: spec }, meta: { name: { score, why } } }.
   */
  function suggestMapping(standard, table) {
    var header = table.header, rows = table.rows, cand = [];
    var samples = header.map(function (h, i) { return columnSample(rows, i, 200); });
    standard.fields.forEach(function (f) {
      header.forEach(function (h, i) {
        var ns = nameScore(h, f), vals = samples[i], sc = ns.score, why = ns.why;
        var det = DETECT[f.name] || (f.type === 'date' ? DATE_LIKE : null);
        if (det && vals.length) {
          var sh = share(vals, det);
          if (sh >= 0.8 && DETECT[f.name] && f.type !== 'date') {
            var cs = 0.55 + (f.name === 'contact_phone' ? -0.1 : 0);
            if (sc >= 0.45) { sc = Math.min(1, sc + 0.08); why += ', wartości pasują'; }
            else if (cs > sc) { sc = cs; why = 'wartości wyglądają na: ' + f.label.toLowerCase(); }
          } else if (sh < 0.2 && sc > 0 && (f.type === 'date' || f.name === 'lat' || f.name === 'lon' || f.name === 'postcode' || f.name === 'udi_di')) {
            sc *= 0.6; why += ', ale wartości nie pasują';
          }
        }
        if (sc >= 0.45) cand.push({ field: f.name, col: h, score: sc, why: why });
      });
    });
    cand.sort(function (a, b) { return b.score - a.score; });
    var fields = {}, meta = {}, usedCols = {};
    cand.forEach(function (c) {
      if (fields[c.field] || usedCols[c.col]) return;
      fields[c.field] = { src: 'col', col: c.col, tr: '' };
      meta[c.field] = { score: c.score, why: c.why };
      usedCols[c.col] = true;
    });

    // kolumna z pełnym adresem
    header.forEach(function (h, i) {
      if (usedCols[h] && !(fields.address && fields.address.col === h && !fields.address.tr)) return;
      var isAddr = variants(h).some(function (v) { return ADDRESS_SYN.indexOf(v) >= 0; });
      var sh = share(samples[i], ADDR_LIKE);
      if (!isAddr && sh < 0.6) return;
      if (isAddr && samples[i].length && share(samples[i], function (v) { return /[a-ząćęłńóśźż]/i.test(v); }) < 0.5) return;
      var parts = { street: 'adres_ulica', house_number: 'adres_numer', postcode: 'adres_kod', city: 'adres_miejscowosc' }, any = false;
      Object.keys(parts).forEach(function (k) {
        if (fields[k]) return;
        fields[k] = { src: 'col', col: h, tr: parts[k] }; meta[k] = { score: 0.8, why: 'wyciągnięte z kolumny z adresem' }; any = true;
      });
      if (any) usedCols[h] = true;
    });
    // kolumna z dwiema współrzędnymi
    header.forEach(function (h, i) {
      if (usedCols[h] || (fields.lat && fields.lon)) return;
      var isC = variants(h).some(function (v) { return COORD_SYN.indexOf(v) >= 0; });
      var sh = share(samples[i], COORD_LIKE);
      if (!(sh >= 0.8 || (isC && sh >= 0.5))) return;
      if (!fields.lat) { fields.lat = { src: 'col', col: h, tr: 'wsp_szer' }; meta.lat = { score: 0.85, why: 'z kolumny ze współrzędnymi' }; }
      if (!fields.lon) { fields.lon = { src: 'col', col: h, tr: 'wsp_dl' }; meta.lon = { score: 0.85, why: 'z kolumny ze współrzędnymi' }; }
      usedCols[h] = true;
    });
    // „dostępny 24/7” można wyliczyć z godzin
    if (!fields.is_24_7 && fields.opening_hours && fields.opening_hours.src === 'col') {
      fields.is_24_7 = { src: 'col', col: fields.opening_hours.col, tr: 'z_godzin' };
      meta.is_24_7 = { score: 0.7, why: 'wyliczone z godzin dostępności' };
    }
    return { fields: fields, meta: meta };
  }

  // ---------- przekształcenia ----------

  var TRANSFORMS = {
    adres_ulica: { label: 'ulica z adresu', fields: ['street'] },
    adres_numer: { label: 'numer z adresu', fields: ['house_number'] },
    adres_kod: { label: 'kod pocztowy z adresu', fields: ['postcode'] },
    adres_miejscowosc: { label: 'miejscowość z adresu', fields: ['city'] },
    wsp_szer: { label: 'szerokość z pary współrzędnych', fields: ['lat'] },
    wsp_dl: { label: 'długość z pary współrzędnych', fields: ['lon'] },
    z_godzin: { label: 'tak, gdy godziny to 24/7', fields: ['is_24_7'] }
  };
  function transformsFor(fieldName) {
    return Object.keys(TRANSFORMS).filter(function (k) { return TRANSFORMS[k].fields.indexOf(fieldName) >= 0; });
  }

  function parseAddress(s) {
    var out = { ulica: '', numer: '', kod: '', miejscowosc: '' };
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (!s) return out;
    var segs = s.split(/\s*[,;\n]\s*/).filter(Boolean), rest = [];
    segs.forEach(function (seg) {
      var m = /(^|\s)(\d{2})\s?-\s?(\d{3})(\s|$)/.exec(seg);
      if (m && !out.kod) {
        out.kod = m[2] + '-' + m[3];
        var before = seg.slice(0, m.index).trim(), after = seg.slice(m.index + m[0].length).trim();
        if (after) out.miejscowosc = after;
        if (before) rest.push(before);
      } else rest.push(seg);
    });
    var streetSeg = null;
    for (var i = 0; i < rest.length; i++) {
      if (/\s(lok\.?|lokal|m\.|mieszk\.?|pok\.?)\s*\d+\w*$/i.test(rest[i])) continue;
      if (/\d/.test(rest[i]) && /^(.*?[^\d\s].*?)\s+(\d+[a-z]?(\s*[\/-]\s*\d+[a-z]?)?)$/i.test(rest[i])) { streetSeg = i; break; }
    }
    if (streetSeg === null) {
      for (var q = 0; q < rest.length; q++) { var cut = rest[q].replace(/\s+(lok\.?|lokal|m\.|mieszk\.?|pok\.?)\s*\d+\w*$/i, ''); if (cut !== rest[q] && /\d$/.test(cut)) { rest[q] = cut; streetSeg = q; break; } }
    }
    if (streetSeg !== null) {
      var mm = /^(.*?)\s+(\d+[a-z]?(?:\s*[\/-]\s*\d+[a-z]?)?)$/i.exec(rest[streetSeg]);
      out.ulica = mm[1].trim(); out.numer = mm[2].replace(/\s+/g, '').toUpperCase();
      rest.splice(streetSeg, 1);
    }
    if (!out.miejscowosc && rest.length) out.miejscowosc = rest[rest.length - 1].replace(/^(m\.|miasto|gm\.)\s*/i, '').trim();
    out.miejscowosc = out.miejscowosc.replace(/^(m\.|miasto)\s+/i, '');
    // miejscowość bez ulic: „Wola Duża 12, 21-030 Wola Duża”
    if (out.ulica && out.miejscowosc && stripDiacritics(out.ulica).toLowerCase() === stripDiacritics(out.miejscowosc).toLowerCase()) out.ulica = '';
    return out;
  }

  function dmsToDec(s) {
    var m = /^\s*(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['′’]\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:["″”]|''))?\s*([NSEW])?\s*$/i.exec(s);
    if (!m) return null;
    var d = Number(m[1]) + Number(m[2]) / 60 + (m[3] ? Number(m[3].replace(',', '.')) / 3600 : 0);
    if (/[SW]/i.test(m[4] || '')) d = -d;
    return d.toFixed(6);
  }

  /** "50.06143, 19.93658", "50,06143 19,93658", "POINT(19.93 50.06)", "50°03'41\"N 19°56'11\"E" → { lat, lon } */
  function parseCoords(v) {
    var s = String(v || '').trim();
    if (!s) return null;
    var wkt = /^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(s);
    if (wkt) return { lat: wkt[2], lon: wkt[1] };
    var dms = s.match(/\d{1,3}\s*[°º][^NSEWnsew]*[NSEW]/gi);
    if (dms && dms.length === 2) {
      var a = dmsToDec(dms[0]), b = dmsToDec(dms[1]);
      if (a && b) return /[EW]\s*$/i.test(dms[0]) ? { lat: b, lon: a } : { lat: a, lon: b };
    }
    var nums = s.match(/-?\d+(?:[.,]\d+)?/g);
    if (!nums || nums.length !== 2 || s.replace(/-?\d+(?:[.,]\d+)?/g, '').replace(/[\s,;|\/NnEe]/g, '') !== '') return null;
    var x = nums[0].replace(',', '.'), y = nums[1].replace(',', '.');
    if (Number(x) >= 14 && Number(x) <= 24.2 && Number(y) >= 49 && Number(y) <= 55) return { lat: y, lon: x, swapped: true };
    return { lat: x, lon: y };
  }

  var PL_DAYS = [
    [/^(pon(iedzia[lł]ek|iedz)?|pn)\.?$/i, 'Mo'], [/^(wt(orek)?)\.?$/i, 'Tu'], [/^([sś]r(oda)?)\.?$/i, 'We'],
    [/^(czw(artek)?|cz)\.?$/i, 'Th'], [/^(pi[aą]t(ek)?|pt)\.?$/i, 'Fr'], [/^(sob(ota)?|so)\.?$/i, 'Sa'],
    [/^(niedz(iela)?|nd|ndz|nie)\.?$/i, 'Su'], [/^(mo|tu|we|th|fr|sa|su|ph)$/i, null], [/^([sś]wi[eę]ta)$/i, 'PH']
  ];
  function dayCode(t) {
    for (var i = 0; i < PL_DAYS.length; i++) if (PL_DAYS[i][0].test(t)) return PL_DAYS[i][1] || (t[0].toUpperCase() + t[1].toLowerCase());
    return null;
  }
  function hhmm(t) {
    var m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(t);
    if (!m || Number(m[1]) > 24 || (m[2] && Number(m[2]) > 59)) return null;
    return m[1].padStart(2, '0') + ':' + (m[2] || '00');
  }
  /** „pn-pt 7-19, sob 9:00-13:00” → „Mo-Fr 07:00-19:00; Sa 09:00-13:00”. Zwraca null, gdy się nie da. */
  function polishHoursToOsm(s) {
    var src = String(s || '').trim();
    if (!src) return null;
    if (/^(24\/7|24h|24 ?h\/7|całodobowo|calodobowo|całą dobę|cała doba|non[- ]?stop|zawsze)$/i.test(src)) return '24/7';
    var text = src.toLowerCase().replace(/\b(codziennie|ca[lł]y tydzie[nń]|7 dni w tygodniu)\b/g, 'mo-su').replace(/\b(dni robocze|w dni robocze|robocze)\b/g, 'mo-fr').replace(/\s*(godz\.?|w godz\.?|od|w godzinach)\s*/g, ' ').replace(/\s+do\s+/g, '-').replace(/[–—]/g, '-').replace(/\bdo\b/g, '-');
    var rules = text.split(/\s*[;,\n]\s*(?=[a-ząćęłńóśźż])/i), out = [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i].trim(); if (!r) continue;
      var m = /^([a-ząćęłńóśźż.]+(?:\s*[-,]\s*[a-ząćęłńóśźż.]+)*)\s*:?\s*(.*)$/i.exec(r);
      if (!m) return null;
      var dayPart = m[1].replace(/\s+/g, ''), timePart = m[2].trim();
      var days = dayPart.split(',').map(function (g) {
        var ends = g.split('-'); if (ends.length > 2) return null;
        var a = dayCode(ends[0]), b = ends[1] ? dayCode(ends[1]) : '';
        return a && b !== null ? a + (b ? '-' + b : '') : null;
      });
      if (days.some(function (d) { return !d; })) return null;
      if (/^(nieczynne|zamkni[eę]te|nieczynny|brak|off|closed)$/.test(timePart)) { out.push(days.join(',') + ' off'); continue; }
      if (/^(całodobowo|calodobowo|24h)$/.test(timePart)) { out.push(days.join(',') + ' 00:00-24:00'); continue; }
      var spans = timePart.split(/\s*[,;i]\s*/).filter(Boolean).map(function (sp) {
        var p = sp.replace(/\s/g, '').split('-'); if (p.length !== 2) return null;
        var a = hhmm(p[0]), b = hhmm(p[1]); return a && b ? a + '-' + b : null;
      });
      if (!spans.length || spans.some(function (x) { return !x; })) return null;
      out.push(days.join(',') + ' ' + spans.join(','));
    }
    return out.length ? out.join('; ') : null;
  }

  function excelSerialToIso(n) {
    var ms = Math.round((Number(n) - 25569) * 86400000);
    return new Date(ms).toISOString().slice(0, 10);
  }

  // ---------- słowniki: podpowiedzi wartości ----------

  var VALUE_HINTS = {
    access: [[/og[oó]lno|publ|dla wszystkich|ka[zż]dy|bez ogranicze|^yes$/i, 'yes'], [/klient|godzin(ach)? (otwarcia|pracy)|odwiedzaj|go[sś]ci|pacjent|interesant|dla_klientow|wiern|uczni/i, 'customers'], [/zgod|pro[sś]b|zg[lł]osz|portier|recepcj|za_zgoda|przepustk/i, 'permit'], [/prywat|wewn[eę]trzn|pracownik|personel|tylko dla/i, 'private'], [/niedost|brak dost|zamkni/i, 'no']],
    unlock_method: [[/brak|otwart|bez zabezp|swobod/i, 'none'], [/112|kod/i, 'code_112'], [/klucz/i, 'key'], [/personel|pracownik|obs[lł]ug|portier|ochron/i, 'staff']],
    status: [[/^(ok|dzia[lł]a|aktywn|sprawn|czynn|tak|w u[zż]yciu|zainstalowan)/i, 'active'], [/naprawi|uszkodz|niesprawn|awari|serwis|nie dzia/i, 'out_of_service'], [/usuni|zdemont|wycofan|zlikwid|nieaktywn/i, 'removed'], [/nieznan|\?|brak danych/i, 'unknown']]
  };
  var BOOL_HINTS = {
    _: [[/^(x|✓|✔|v|\+|prawda|jest|posiada|ma)$/i, 'tak'], [/^(-|–|brak|fa[lł]sz|nie ma|bez)$/i, 'nie']],
    indoor: [[/wewn|w [sś]rodku|w budynku|hol|korytarz|parter|pi[eę]tro/i, 'tak'], [/zewn|elewac|na [sś]cian(ie)? zewn|przed budynk|na zewn/i, 'nie']],
    is_24_7: [[/ca[lł]odob|24\s*\/\s*7|24h|ca[lł][aą] dob|zawsze|non.?stop/i, 'tak'], [/godzin|w dni|pn|pon|mo-/i, 'nie']],
    cabinet_locked: [[/zamkn|kod|klucz|plomb|alarm/i, 'tak'], [/otwart|bez zabezp/i, 'nie']],
    paediatric_capable: [[/pediatr|dzieci/i, 'tak']]
  };
  function suggestValue(field, raw) {
    var s = String(raw).trim(), list;
    if (field.type === 'boolean') {
      list = (BOOL_HINTS[field.name] || []).concat(BOOL_HINTS._);
    } else list = VALUE_HINTS[field.name] || [];
    for (var i = 0; i < list.length; i++) if (list[i][0].test(s)) return list[i][1];
    return '';
  }

  // ---------- wczytywanie plików ----------

  function uniqueHeader(h) {
    var seen = {};
    return h.map(function (x, i) {
      var base = String(x == null ? '' : x).replace(/^﻿/, '').replace(/\s+/g, ' ').trim() || 'Kolumna ' + colLetter(i);
      var name = base, k = 2;
      while (seen[name]) name = base + ' (' + (k++) + ')';
      seen[name] = true; return name;
    });
  }
  function colLetter(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

  /** Zgaduje wiersz nagłówka: pierwszy wiersz z co najmniej 60% wypełnionych kolumn, w większości tekstowy. */
  function guessHeaderRow(matrix) {
    var lim = Math.min(matrix.length, 20), max = 0, i;
    for (i = 0; i < lim; i++) max = Math.max(max, filled(matrix[i]));
    for (i = 0; i < lim; i++) {
      var r = matrix[i], f = filled(r);
      if (f >= Math.max(2, Math.ceil(max * 0.6))) {
        var txt = r.filter(function (v) { return v != null && String(v).trim() !== '' && isNaN(num(v)); }).length;
        if (txt >= f * 0.7) return i;
      }
    }
    return 0;
    function filled(r) { return (r || []).filter(function (v) { return v != null && String(v).trim() !== ''; }).length; }
  }

  /** Z macierzy wierszy robi tabelę { header, rows, lines } od podanego wiersza nagłówka. */
  function tableFromMatrix(matrix, headerRow) {
    var h = headerRow == null ? guessHeaderRow(matrix) : headerRow;
    var width = 0;
    matrix.forEach(function (r) { width = Math.max(width, r.length); });
    var head = (matrix[h] || []).slice();
    while (head.length < width) head.push('');
    // usuń puste kolumny na końcu
    var rows = [], lines = [];
    for (var i = h + 1; i < matrix.length; i++) {
      var r = matrix[i];
      if (!r.some(function (v) { return v != null && String(v).trim() !== ''; })) continue;
      var row = []; for (var j = 0; j < width; j++) row.push(r[j] == null ? '' : String(r[j]));
      rows.push(row); lines.push(i + 1);
    }
    var keep = [];
    for (var c = 0; c < width; c++) {
      var hasHead = head[c] != null && String(head[c]).trim() !== '';
      if (hasHead || rows.some(function (r) { return r[c].trim() !== ''; })) keep.push(c);
    }
    return {
      header: uniqueHeader(keep.map(function (c) { return head[c]; })).map(function (x, k) { return x.replace(/^Kolumna [A-Z]+$/, 'Kolumna ' + colLetter(keep[k])); }),
      rows: rows.map(function (r) { return keep.map(function (c) { return r[c]; }); }),
      lines: lines, headerRow: h
    };
  }

  function flatten(obj, prefix, out) {
    out = out || {};
    Object.keys(obj || {}).forEach(function (k) {
      var v = obj[k], key = prefix ? prefix + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
      else out[key] = Array.isArray(v) ? v.join('; ') : v;
    });
    return out;
  }

  /** JSON: tablica obiektów, GeoJSON FeatureCollection, Overpass { elements } albo obiekt z tablicą rekordów. */
  function readJson(text) {
    var data = JSON.parse(String(text).replace(/^﻿/, ''));
    var list = null, kind = 'JSON';
    if (data && data.type === 'FeatureCollection' && Array.isArray(data.features)) {
      kind = 'GeoJSON';
      list = data.features.map(function (f) {
        var o = flatten(f.properties || {});
        if (f.id != null && o.id == null) o.id = f.id;
        var g = f.geometry;
        if (g && g.type === 'Point' && Array.isArray(g.coordinates)) { o[o.lat == null ? 'lat' : 'geometry_lat'] = g.coordinates[1]; o[o.lon == null ? 'lon' : 'geometry_lon'] = g.coordinates[0]; }
        return o;
      });
    } else if (Array.isArray(data)) list = data;
    else if (data && typeof data === 'object') {
      var best = null;
      Object.keys(data).forEach(function (k) { if (Array.isArray(data[k]) && data[k].length && typeof data[k][0] === 'object' && (!best || data[k].length > best.length)) best = data[k]; });
      list = best;
    }
    if (!list || !list.length) throw new Error('W pliku JSON nie ma listy rekordów. Oczekiwana jest tablica obiektów albo GeoJSON FeatureCollection.');
    var rows = list.map(function (o) { return typeof o === 'object' ? flatten(o) : { wartosc: o }; });
    var keys = [], seen = {};
    rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (!seen[k]) { seen[k] = true; keys.push(k); } }); });
    var matrix = [keys].concat(rows.map(function (r) { return keys.map(function (k) { return r[k] == null ? '' : String(r[k]); }); }));
    return { kind: kind, matrix: matrix };
  }

  // --- XLSX (ZIP + XML) bez bibliotek ---

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function unzipIndex(bytes) {
    var eocd = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('To nie jest poprawny plik XLSX (brak struktury ZIP).');
    var n = u16(bytes, eocd + 10), off = u32(bytes, eocd + 16), files = {};
    for (var k = 0; k < n; k++) {
      if (u32(bytes, off) !== 0x02014b50) break;
      var method = u16(bytes, off + 10), csize = u32(bytes, off + 20), nlen = u16(bytes, off + 28), elen = u16(bytes, off + 30), clen = u16(bytes, off + 32), loc = u32(bytes, off + 42);
      var name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nlen));
      files[name] = { method: method, csize: csize, loc: loc };
      off += 46 + nlen + elen + clen;
    }
    return files;
  }
  function unzipRead(bytes, entry) {
    var o = entry.loc, start = o + 30 + u16(bytes, o + 26) + u16(bytes, o + 28), data = bytes.subarray(start, start + entry.csize);
    if (entry.method === 0) return Promise.resolve(new TextDecoder().decode(data));
    if (entry.method !== 8) return Promise.reject(new Error('Nieobsługiwana kompresja w pliku XLSX.'));
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('Ta przeglądarka nie umie otworzyć XLSX. Zapisz plik jako CSV (UTF-8) i wczytaj ponownie.'));
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([data]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (ab) { return new TextDecoder().decode(new Uint8Array(ab)); });
  }
  function xmlText(s) {
    return s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(Number(d)); }).replace(/&amp;/g, '&');
  }
  function attr(tag, name) { var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; }
  function colIndex(ref) { var m = /^([A-Z]+)/.exec(ref), n = 0; for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64); return n - 1; }

  /** Wczytuje XLSX. Zwraca Promise<{ sheets: [{ name, matrix }] }>. Komórki z formatem daty zamienia na RRRR-MM-DD. */
  function readXlsx(buf) {
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf), files = unzipIndex(bytes);
    function get(p) { return files[p] ? unzipRead(bytes, files[p]) : Promise.resolve(''); }
    return Promise.all([get('xl/workbook.xml'), get('xl/_rels/workbook.xml.rels'), get('xl/sharedStrings.xml'), get('xl/styles.xml')]).then(function (r) {
      var wb = r[0], rels = r[1], ss = r[2], styles = r[3];
      if (!wb) throw new Error('W pliku nie ma skoroszytu Excela.');
      var date1904 = /date1904="(1|true)"/.test(wb);
      var strings = [];
      (ss.match(/<si>[\s\S]*?<\/si>/g) || []).forEach(function (si) {
        var ts = si.replace(/<rPh[\s\S]*?<\/rPh>/g, '').match(/<t[^>]*>[\s\S]*?<\/t>/g) || [];
        strings.push(ts.map(xmlText).join(''));
      });
      var custom = {};
      (styles.match(/<numFmt [^>]*>/g) || []).forEach(function (t) { custom[attr(t, 'numFmtId')] = xmlText(attr(t, 'formatCode') || ''); });
      var xfs = [], cx = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
      if (cx) (cx[1].match(/<xf [^>]*>/g) || []).forEach(function (t) { xfs.push(Number(attr(t, 'numFmtId') || 0)); });
      function isDateStyle(s) {
        var id = xfs[Number(s)]; if (id == null) return false;
        if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)) return true;
        var code = custom[id]; if (!code) return false;
        code = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
        return /[dy]/i.test(code) || /(^|[^h])m{1,4}([^s]|$)/i.test(code) && /[dy]/i.test(code);
      }
      var relMap = {};
      (rels.match(/<Relationship [^>]*>/g) || []).forEach(function (t) { relMap[attr(t, 'Id')] = attr(t, 'Target'); });
      var sheetDefs = (wb.match(/<sheet [^>]*>/g) || []).map(function (t) {
        var target = relMap[attr(t, 'r:id')] || '';
        target = target.replace(/^\//, '').replace(/^xl\//, '');
        return { name: xmlText(attr(t, 'name') || 'Arkusz'), path: 'xl/' + target, hidden: attr(t, 'state') === 'hidden' };
      }).filter(function (s) { return !s.hidden; });
      return Promise.all(sheetDefs.map(function (sd) { return get(sd.path); })).then(function (xmls) {
        return {
          sheets: sheetDefs.map(function (sd, i) {
            var matrix = [], xml = xmls[i];
            (xml.match(/<row[\s>][\s\S]*?<\/row>|<row [^>]*\/>/g) || []).forEach(function (rowXml) {
              var rn = Number(attr(rowXml.slice(0, rowXml.indexOf('>') + 1), 'r')) || matrix.length + 1, row = [];
              var cells = rowXml.match(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g) || [];
              cells.forEach(function (c, ci) {
                var open = c.slice(0, c.indexOf('>') + 1), ref = attr(open, 'r'), t = attr(open, 't'), s = attr(open, 's');
                var vm = /<v>([\s\S]*?)<\/v>/.exec(c), val = '';
                if (t === 's') val = vm ? strings[Number(vm[1])] || '' : '';
                else if (t === 'inlineStr') val = ((c.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(xmlText)).join('');
                else if (t === 'b') val = vm ? (vm[1] === '1' ? 'tak' : 'nie') : '';
                else if (t === 'str' || t === 'e') val = vm ? xmlText(vm[1]) : '';
                else if (vm) {
                  var n = Number(vm[1]);
                  if (s != null && isDateStyle(s) && n > 0 && n < 2958466) val = excelSerialToIso(date1904 ? n + 1462 : n);
                  else val = String(n);
                }
                row[ref ? colIndex(ref) : ci] = val;
              });
              matrix[rn - 1] = row;
            });
            for (var k = 0; k < matrix.length; k++) if (!matrix[k]) matrix[k] = [];
            for (k = 0; k < matrix.length; k++) for (var j = 0; j < matrix[k].length; j++) if (matrix[k][j] == null) matrix[k][j] = '';
            return { name: sd.name, matrix: matrix };
          })
        };
      });
    });
  }

  // --- XML bez bibliotek: dowolna lista rekordów, arkusz Excel 2003 XML (SpreadsheetML), KML ---

  /** Prosty parser XML do drzewa { name, attrs, children, text }. Pomija komentarze, deklaracje i instrukcje. */
  function parseXmlTree(src) {
    var root = { name: '#doc', attrs: {}, children: [], text: '' }, stack = [root], re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>\[]*(?:\[[\s\S]*?\])?\s*>|<\/\s*([^\s>]+)\s*>|<([^\s>\/!?]+)((?:\s+[^\s=>\/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g, m;
    while ((m = re.exec(src))) {
      var top = stack[stack.length - 1];
      if (m[1] != null) top.text += m[1];
      else if (m[2]) {
        var nm = local(m[2]);
        for (var k = stack.length - 1; k > 0; k--) if (stack[k].name === nm) { stack.length = k; break; }
      } else if (m[3]) {
        var el = { name: local(m[3]), attrs: {}, children: [], text: '' }, ar = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, a;
        while ((a = ar.exec(m[4] || ''))) { var an = /^gml:/.test(a[1]) ? a[1] : local(a[1]); if (!/^xmlns/.test(a[1])) el.attrs[an] = xmlText(a[3] != null ? a[3] : a[4]); }
        top.children.push(el);
        if (!m[5]) stack.push(el);
      } else if (m[6] != null) top.text += xmlText(m[6]);
    }
    if (stack.length > 1 && !root.children.length) throw new Error('Plik XML jest uszkodzony.');
    return root;
    function local(n) { var i = n.indexOf(':'); return i >= 0 ? n.slice(i + 1) : n; }
  }

  function xmlFlatten(el, prefix, out) {
    Object.keys(el.attrs).forEach(function (k) { if (!(el.attrs.name && k === 'name' && isNamedValue(el))) put(prefix ? prefix + '.@' + k : '@' + k, el.attrs[k]); });
    var groups = {};
    el.children.forEach(function (c) { groups[c.name] = (groups[c.name] || 0) + 1; });
    var seen = {};
    el.children.forEach(function (c) {
      var key;
      if (isNamedValue(c)) key = c.attrs.name;                        // <Data name="telefon"><value>…</value></Data>, <field name="x">…</field>
      else { seen[c.name] = (seen[c.name] || 0) + 1; key = c.name + (groups[c.name] > 1 ? '[' + seen[c.name] + ']' : ''); }
      key = prefix ? prefix + '.' + key : key;
      var ownAttrs = Object.keys(c.attrs).filter(function (k) { return !(k === 'name' && isNamedValue(c)); }).length;
      if (!c.children.length && !ownAttrs) put(key, c.text.trim());
      else if (!c.children.length) { if (c.text.trim()) put(key, c.text.trim()); xmlFlatten(c, key, out); }
      else if (isNamedValue(c) && c.children.length === 1 && !c.children[0].children.length) put(key, c.children[0].text.trim());
      else xmlFlatten(c, key, out);
    });
    return out;
    function put(k, v) { if (v === '' && out[k] !== undefined) return; out[k] = out[k] ? out[k] + '; ' + v : v; }
  }
  function isNamedValue(c) { return c.attrs.name != null && /^(data|simpledata|field|pole|property|attribute|atrybut|param|value|column|kolumna)$/i.test(c.name); }

  /** Rekordy: najwyżej położona grupa co najmniej dwóch jednakowych elementów-rodzeństwa z zawartością (największa, gdy jest ich kilka).
      Gdy takiej nie ma, jeden element z co najmniej trzema prostymi polami. */
  function findRecords(root) {
    var cands = [], single = null;
    (function walk(el, depth) {
      var groups = {}, order = [];
      el.children.forEach(function (c) { if (!groups[c.name]) { groups[c.name] = []; order.push(c.name); } groups[c.name].push(c); });
      order.forEach(function (n) {
        var g = groups[n], rich = g.filter(function (c) { return c.children.length || Object.keys(c.attrs).length > 1; }).length;
        if (g.length >= 2 && rich >= 2) cands.push({ list: g, name: n, depth: depth });
        else g.forEach(function (c) {
          if (!single && c.children.filter(function (x) { return !x.children.length; }).length >= 3) single = { list: [c], name: c.name, depth: depth };
          walk(c, depth + 1);
        });
      });
    })(root, 0);
    cands.sort(function (a, b) { return b.list.length - a.list.length || a.depth - b.depth; });
    return cands[0] || single;
  }

  // --- GML: geometria punktu i układy współrzędnych używane w Polsce ---

  /** Odwrotne odwzorowanie Gaussa-Krügera (GRS80): metry → stopnie. */
  function tmInverse(E, N, lon0, k0, FE, FN) {
    var a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    var M = (N - FN) / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
    var e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    var p1 = mu + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu) +
      (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu) + (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);
    var C1 = ep2 * Math.pow(Math.cos(p1), 2), T1 = Math.pow(Math.tan(p1), 2), N1 = a / Math.sqrt(1 - e2 * Math.pow(Math.sin(p1), 2));
    var R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.pow(Math.sin(p1), 2), 1.5), D = (E - FE) / (N1 * k0);
    var lat = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(D, 4) / 24 +
      (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(D, 6) / 720);
    var lon = (D - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(D, 5) / 120) / Math.cos(p1);
    return { lat: lat * 180 / Math.PI, lon: lon0 + lon * 180 / Math.PI };
  }
  var CRS = {
    2180: { name: 'PUWG 1992', tm: [19, 0.9993, 500000, -5300000] },
    2176: { name: 'PUWG 2000 strefa 5', tm: [15, 0.999923, 5500000, 0] },
    2177: { name: 'PUWG 2000 strefa 6', tm: [18, 0.999923, 6500000, 0] },
    2178: { name: 'PUWG 2000 strefa 7', tm: [21, 0.999923, 7500000, 0] },
    2179: { name: 'PUWG 2000 strefa 8', tm: [24, 0.999923, 8500000, 0] },
    4326: { name: 'WGS 84' }, 4258: { name: 'ETRS89' }, 4311: { name: 'ETRS89' }, 3857: { name: 'Web Mercator' }
  };
  function inPl(p) { return p && p.lat >= 49 && p.lat <= 55 && p.lon >= 14 && p.lon <= 24.2; }

  /**
   * Para liczb z GML → { lat, lon, crs } w WGS 84. Kolejność osi: dla zapisu urn:ogc / http://www.opengis.net (GML 3.2)
   * najpierw oś z definicji EPSG (szerokość / northing), dla krótkiego „EPSG:xxxx” zwykle x, y. Gdy zgadnięta kolejność daje punkt
   * poza Polską, a odwrotna w Polsce, wybierana jest odwrotna.
   */
  function gmlPointToWgs(a, b, srsName) {
    var code = Number((/(\d{4,5})\s*$/.exec(srsName || '') || [])[1]) || 4326, crs = CRS[code];
    if (!crs) return { error: 'Nieobsługiwany układ współrzędnych ' + srsName + '. Obsługiwane: WGS 84, ETRS89, PUWG 1992 (EPSG:2180), PUWG 2000 (EPSG:2176–2179), EPSG:3857.' };
    var epsgOrder = /urn:|opengis\.net\/def/i.test(srsName || ''), first, second;
    function conv(x, y) {                       // x = wschód / długość, y = północ / szerokość
      if (crs.tm) return tmInverse(x, y, crs.tm[0], crs.tm[1], crs.tm[2], crs.tm[3]);
      if (code === 3857) return { lon: x / 6378137 * 180 / Math.PI, lat: (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI };
      return { lon: x, lat: y };
    }
    var geoAxisLatFirst = code !== 3857 && epsgOrder;   // w EPSG 4326/4258 i PUWG najpierw szerokość / northing
    first = geoAxisLatFirst ? conv(b, a) : conv(a, b);
    second = geoAxisLatFirst ? conv(a, b) : conv(b, a);
    function ok(q) { return inPl(q) && (!crs.tm || crs.tm[1] !== 0.999923 || Math.abs(q.lon - crs.tm[0]) <= 2); }   // strefy PUWG 2000: ±1,5° od południka
    var p = ok(first) || !ok(second) ? first : second;
    return { lat: p.lat.toFixed(6), lon: p.lon.toFixed(6), crs: crs.name + (code ? ' (EPSG:' + code + ')' : ''), converted: !!crs.tm || code === 3857 };
  }

  /** Szuka pierwszej geometrii w rekordzie GML; zwraca { child, numbers, srs } i usuwa ją z drzewa rekordu. */
  function takeGmlGeometry(rec, docSrs) {
    var found = null;
    (function walk(el, srs, top) {
      if (found) return;
      srs = el.attrs.srsName || srs;
      if (/^(pos|coordinates|posList)$/.test(el.name) && el.text.trim()) { found = { top: top, nums: el.text.trim().split(/[\s,]+/).map(Number), srs: srs }; return; }
      if (el.name === 'coord') {
        var X = el.children.filter(function (c) { return c.name === 'X'; })[0], Y = el.children.filter(function (c) { return c.name === 'Y'; })[0];
        if (X && Y) { found = { top: top, nums: [Number(X.text), Number(Y.text)], srs: srs, xy: true }; return; }
      }
      el.children.forEach(function (c) { walk(c, srs, top || c); });
    })(rec, docSrs, null);
    if (found && found.top) rec.children = rec.children.filter(function (c) { return c !== found.top; });
    return found;
  }

  function readXml(text) {
    var root = parseXmlTree(text);
    // Arkusz Excel 2003 XML: Workbook > Worksheet > Table > Row > Cell > Data
    var wb = root.children.filter(function (c) { return c.name === 'Workbook'; })[0];
    if (wb) {
      var sheets = wb.children.filter(function (c) { return c.name === 'Worksheet'; }).map(function (ws) {
        var table = ws.children.filter(function (c) { return c.name === 'Table'; })[0], matrix = [];
        (table ? table.children : []).filter(function (c) { return c.name === 'Row'; }).forEach(function (row) {
          var r = row.attrs.Index ? Number(row.attrs.Index) - 1 : matrix.length, cells = [], col = 0;
          row.children.filter(function (c) { return c.name === 'Cell'; }).forEach(function (cell) {
            if (cell.attrs.Index) col = Number(cell.attrs.Index) - 1;
            var d = cell.children.filter(function (c) { return c.name === 'Data'; })[0], v = d ? d.text : '';
            if (d && d.attrs.Type === 'DateTime') v = v.slice(0, 10);
            if (d && d.attrs.Type === 'Boolean') v = v === '1' ? 'tak' : 'nie';
            cells[col++] = v;
          });
          for (var i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = '';
          while (matrix.length < r) matrix.push([]);
          matrix[r] = cells;
        });
        return { name: ws.attrs.Name || 'Arkusz', matrix: matrix };
      });
      if (sheets.length) return { kind: 'XML (Excel 2003)', sheets: sheets };
    }
    var rec = findRecords(root);
    if (!rec) throw new Error('W pliku XML nie znaleziono powtarzających się rekordów (np. wielu elementów <aed> lub <wiersz>).');
    var isKml = rec.name === 'Placemark';
    // GML / WFS: <featureMember><Obiekt>…</Obiekt></featureMember> → rozpakuj obiekt
    var list = rec.list.map(function (el) { return /^(featureMember|member)$/.test(el.name) && el.children.length === 1 ? el.children[0] : el; });
    var recName = list[0] && list[0] !== rec.list[0] ? list[0].name : rec.name;
    var isGml = /<(\w+:)?(featureMembers?|member|FeatureCollection)[\s>]/.test(text) && /opengis\.net\/gml/.test(text);
    var docSrs = (/srsName\s*=\s*"([^"]+)"/.exec(text) || [])[1] || '', crsUsed = {}, geomErr = null;
    var rows = list.map(function (el) {
      var g = isGml ? takeGmlGeometry(el, docSrs) : null;
      var o = xmlFlatten(el, '', {});
      if (g && g.nums.length >= 2 && !isNaN(g.nums[0]) && !isNaN(g.nums[1])) {
        var w = gmlPointToWgs(g.nums[0], g.nums[1], g.xy ? (g.srs || '').replace(/urn:.*::/, 'EPSG:') : g.srs);
        if (w.error) geomErr = w.error; else { o.lat = w.lat; o.lon = w.lon; crsUsed[w.crs] = true; }
      }
      if (isKml) {
        var ck = Object.keys(o).filter(function (k) { return /(^|\.)coordinates$/.test(k); })[0];
        if (ck) { var p = String(o[ck]).trim().split(/[\s,]+/); if (p.length >= 2) { o.lon = p[0]; o.lat = p[1]; delete o[ck]; } }
      }
      return o;
    });
    var keys = [], seen = {};
    rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (!seen[k]) { seen[k] = true; keys.push(k); } }); });
    var matrix = [keys].concat(rows.map(function (r) { return keys.map(function (k) { return r[k] == null ? '' : String(r[k]); }); }));
    if (geomErr && !Object.keys(crsUsed).length) throw new Error(geomErr);
    var crsNames = Object.keys(crsUsed);
    return { kind: isKml ? 'KML' : isGml ? 'GML' + (crsNames.length ? ', współrzędne z ' + crsNames.join(', ') + (/PUWG|Mercator/.test(crsNames.join()) ? ' przeliczone na WGS 84' : '') : '') : 'XML',
      sheets: [{ name: '<' + recName + '> × ' + list.length, matrix: matrix }] };
  }

  /** Dekoduje bajty XML zgodnie z deklaracją encoding (UTF-8, Windows-1250, ISO-8859-2). */
  function decodeXml(bytes, W) {
    var head = new TextDecoder('ascii').decode(bytes.subarray(0, 200)), m = /encoding\s*=\s*["']([^"']+)["']/i.exec(head);
    if (m && !/utf-?8/i.test(m[1])) { try { return { text: new TextDecoder(m[1].toLowerCase()).decode(bytes), encoding: m[1].toUpperCase() }; } catch (e) { /* nieznane kodowanie */ } }
    return W.decodeBytes(bytes);
  }

  /**
   * Wczytuje plik dowolnego obsługiwanego typu.
   * Zwraca Promise<{ kind, encoding?, delimiter?, sheets: [{ name, matrix }] }>.
   */
  function readFile(name, buf, W) {
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf), ext = (/\.([a-z0-9]+)$/i.exec(name || '') || [])[1];
    ext = ext ? ext.toLowerCase() : '';
    var isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (ext === 'xls' && !isZip) return Promise.reject(new Error('Stary format Excela (.xls) nie jest obsługiwany. W Excelu wybierz Plik → Zapisz jako → Skoroszyt programu Excel (.xlsx) albo CSV UTF-8.'));
    if (ext === 'ods') return Promise.reject(new Error('Pliki .ods zapisz w LibreOffice jako .xlsx albo CSV UTF-8.'));
    if (isZip || ext === 'xlsx' || ext === 'xlsm') return readXlsx(bytes).then(function (r) { r.kind = 'XLSX'; return r; });
    var dec = W.decodeBytes(bytes), text = dec.text;
    if (ext === 'xml' || ext === 'kml' || ext === 'gml' || ext === 'wfs' || /^\s*</.test(text)) {
      try {
        var xd = decodeXml(bytes, W), x = readXml(xd.text.replace(/^\uFEFF/, ''));
        return Promise.resolve({ kind: x.kind, encoding: xd.encoding, sheets: x.sheets });
      } catch (e) { return Promise.reject(e); }
    }
    if (ext === 'json' || ext === 'geojson' || /^\s*[\[{]/.test(text)) {
      try { var j = readJson(text); return Promise.resolve({ kind: j.kind, encoding: dec.encoding, sheets: [{ name: j.kind, matrix: j.matrix }] }); }
      catch (e) { if (ext === 'json' || ext === 'geojson') return Promise.reject(e instanceof SyntaxError ? new Error('Plik JSON jest uszkodzony: ' + e.message) : e); }
    }
    var p = W.parseCsv(text);
    return Promise.resolve({ kind: p.delimiter === '\t' ? 'TSV' : 'CSV', encoding: dec.encoding, delimiter: p.delimiter, sheets: [{ name: 'CSV', matrix: p.rows }] });
  }

  // ---------- budowa wierszy standardu ----------

  /**
   * mapping: { fields: { name: { src: 'col'|'const'|'gen'|'none', col, tr, value, prefix } }, values: { name: { raw: code } } }
   * overrides: { rowIndex: { name: value } }
   * Zwraca { header: [names], rows: [[...]], notes: [[issue]] } (notes: informacje o przekształceniach na wiersz).
   */
  function buildRows(standard, table, mapping, overrides) {
    var names = standard.fields.map(function (f) { return f.name; }), colIdx = {};
    table.header.forEach(function (h, i) { colIdx[h] = i; });
    overrides = overrides || {};
    var rows = [], notes = [];
    table.rows.forEach(function (cells, ri) {
      var out = [], nt = [], ov = overrides[ri] || {};
      standard.fields.forEach(function (f) {
        var r = valueFor(standard, f, cells, ri, mapping, colIdx, nt);
        if (Object.prototype.hasOwnProperty.call(ov, f.name)) { r = ov[f.name]; nt.push({ severity: 'info', field: f.name, message: 'Wartość poprawiona ręcznie w konwerterze.' }); }
        out.push(r == null ? '' : String(r));
      });
      // pełny adres złożony z części, gdy w tabeli nie ma go w jednej kolumnie
      var ia = names.indexOf('address');
      if (ia >= 0 && out[ia] === '' && !Object.prototype.hasOwnProperty.call(ov, 'address')) {
        var g = function (n) { var k = names.indexOf(n); return k >= 0 ? out[k] : ''; };
        var line1 = [g('street') || '', g('house_number')].filter(Boolean).join(' '), line2 = [g('postcode'), g('city')].filter(Boolean).join(' ');
        if (!g('street') && g('house_number') && g('city')) line1 = g('city') + ' ' + g('house_number');
        var full = [line1, line2].filter(Boolean).join(', ');
        if (full && (line1 || g('postcode'))) { out[ia] = full; nt.push({ severity: 'info', field: 'address', message: 'Pełny adres złożono z ulicy, numeru, kodu i miejscowości.' }); }
      }
      rows.push(out); notes.push(nt);
    });
    return { header: names, rows: rows, notes: notes };
  }

  function rawFor(spec, cells, colIdx) {
    var i = colIdx[spec.col];
    return i === undefined ? '' : (cells[i] == null ? '' : String(cells[i]).trim());
  }

  function valueFor(standard, f, cells, ri, mapping, colIdx, nt) {
    var spec = mapping.fields[f.name];
    if (!spec || spec.src === 'none' || !spec.src) return '';
    function note(m) { nt.push({ severity: 'info', field: f.name, message: m }); }
    if (spec.src === 'const') return spec.value == null ? '' : String(spec.value);
    if (spec.src === 'gen') return (spec.prefix || 'AED-') + String(ri + 1).padStart(4, '0');
    var v = rawFor(spec, cells, colIdx);
    switch (spec.tr) {
      case 'adres_ulica': v = parseAddress(v).ulica; break;
      case 'adres_numer': v = parseAddress(v).numer; break;
      case 'adres_kod': v = parseAddress(v).kod; break;
      case 'adres_miejscowosc': v = parseAddress(v).miejscowosc; break;
      case 'wsp_szer': case 'wsp_dl': {
        var c = parseCoords(v);
        if (c) { if (c.swapped && spec.tr === 'wsp_szer') note('Para współrzędnych była w kolejności długość, szerokość. Zamieniono.'); v = spec.tr === 'wsp_szer' ? c.lat : c.lon; }
        break;
      }
      case 'z_godzin': {
        if (v === '') break;
        var h = polishHoursToOsm(v);
        v = (h || v) === '24/7' || /^(Mo-Su|pn-nd) ?00:00-24:00$/i.test(h || v) ? 'tak' : 'nie';
        break;
      }
      default: break;
    }
    if (v === '') return '';
    // poprawki typowe dla danego typu pola
    if (f.type === 'date' && /^\d{5}(\.\d+)?$/.test(v) && Number(v) > 20000 && Number(v) < 80000) { var iso = excelSerialToIso(v); note('Liczbę daty z Excela ' + v + ' zamieniono na ' + iso + '.'); v = iso; }
    if (f.type === 'date') {
      var dt = /^(\d{4})[.\/](\d{1,2})[.\/](\d{1,2})$/.exec(v) || /^(\d{4})-(\d{1,2})-(\d{1,2})[ T].*$/.exec(v);
      if (dt) { var iso2 = dt[1] + '-' + dt[2].padStart(2, '0') + '-' + dt[3].padStart(2, '0'); note('Datę „' + v + '” zapisano jako ' + iso2 + '.'); v = iso2; }
      var dm = /^(\d{1,2})[-.\/](\d{1,2})[-.\/](\d{4})$/.exec(v);
      if (dm) { var iso3 = dm[3] + '-' + dm[2].padStart(2, '0') + '-' + dm[1].padStart(2, '0'); note('Datę „' + v + '” zapisano jako ' + iso3 + '.'); v = iso3; }
    }
    if (f.type === 'number' && /[°º]/.test(v)) { var d = dmsToDec(v); if (d) { note('Współrzędną „' + v + '” w stopniach i minutach zamieniono na ' + d + '.'); v = d; } }
    if (f.name === 'postcode') {
      var pc = v.replace(/\s/g, '');
      if (/^\d{4,5}$/.test(pc)) { var fixed = pc.padStart(5, '0'); fixed = fixed.slice(0, 2) + '-' + fixed.slice(2); note('Kod pocztowy „' + v + '” zapisano jako ' + fixed + '.'); v = fixed; }
      else if (/^\d{2}\s*[-–]\s*\d{3}$/.test(v) && v !== pc.replace('–', '-')) v = pc.replace('–', '-');
    }
    if (f.type === 'opening_hours' && !/^24\/7$/.test(v)) {
      var oh = polishHoursToOsm(v);
      if (oh && oh !== v) { note('Godziny „' + v + '” zapisano w składni OSM: ' + oh + '.'); v = oh; }
    }
    if (f.type === 'phone' && /^\d{9}$/.test(v)) v = v.slice(0, 3) + ' ' + v.slice(3, 6) + ' ' + v.slice(6);
    if (f.type === 'phone' && /^48\d{9}$/.test(v)) v = '+' + v;
    if (f.type === 'url' && /^www\./i.test(v)) { note('Dodano https:// do adresu.'); v = 'https://' + v; }
    // słownik użytkownika
    var vm = mapping.values && mapping.values[f.name];
    if (vm && Object.prototype.hasOwnProperty.call(vm, v) && vm[v] !== '') {
      var code = vm[v];
      if (code !== v) note('Wartość „' + v + '” zamieniona na „' + code + '” według Twojego słownika.');
      v = code;
    }
    return v;
  }

  /** Wartości kolumny (po przekształceniu), których walidator nie rozpozna jako kodu słownika lub tak/nie. */
  function unknownValues(standard, table, mapping, field, W) {
    var spec = mapping.fields[field.name];
    if (!spec || spec.src !== 'col') return [];
    var colIdx = {}; table.header.forEach(function (h, i) { colIdx[h] = i; });
    var counts = {}, order = [], dummy = { fields: {}, values: {} };
    dummy.fields[field.name] = spec;
    table.rows.forEach(function (cells, ri) {
      var v = valueFor(standard, field, cells, ri, dummy, colIdx, []);
      if (v === '') return;
      if (!counts[v]) { counts[v] = 0; order.push(v); }
      counts[v]++;
    });
    return order.filter(function (v) {
      var r = W.checkValue(standard, field, v, { today: '2000-01-01' });
      return r.issues.some(function (i) { return i.severity === 'error'; });
    }).map(function (v) { return { raw: v, count: counts[v], suggestion: suggestValue(field, v) }; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  /** Podgląd: pierwsze n niepustych wartości pola po przekształceniu. */
  function previewField(standard, table, mapping, field, n) {
    var colIdx = {}; table.header.forEach(function (h, i) { colIdx[h] = i; });
    var out = [];
    for (var i = 0; i < table.rows.length && out.length < (n || 3); i++) {
      var v = valueFor(standard, field, table.rows[i], i, mapping, colIdx, []);
      if (v !== '') out.push(v);
    }
    return out;
  }

  // ---------- zapis i odczyt mapowania ----------

  function exportMapping(standard, table, mapping, extra) {
    var pola = {};
    Object.keys(mapping.fields).forEach(function (k) {
      var s = mapping.fields[k];
      if (!s || s.src === 'none') return;
      if (s.src === 'col') pola[k] = s.tr ? { kolumna: s.col, przeksztalcenie: s.tr } : { kolumna: s.col };
      else if (s.src === 'const') pola[k] = { stala: s.value };
      else if (s.src === 'gen') pola[k] = { generuj: s.prefix || 'AED-' };
    });
    var wartosci = {};
    Object.keys(mapping.values || {}).forEach(function (k) {
      var m = {}, any = false;
      Object.keys(mapping.values[k]).forEach(function (raw) { if (mapping.values[k][raw]) { m[raw] = mapping.values[k][raw]; any = true; } });
      if (any) wartosci[k] = m;
    });
    var o = { typ: 'aedane-mapowanie', wersja: 1, standard: standard.id + ' ' + standard.version, zapisano: new Date().toISOString(), naglowki: table ? table.header : [], pola: pola, wartosci: wartosci };
    if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }

  /** Zwraca { mapping, missingCols: [] } */
  function importMapping(standard, obj, table) {
    if (!obj || obj.typ !== 'aedane-mapowanie' || !obj.pola) throw new Error('To nie jest plik mapowania konwertera AEDane.');
    var known = {}; standard.fields.forEach(function (f) { known[f.name] = true; });
    var cols = {}; (table ? table.header : []).forEach(function (h) { cols[h] = true; });
    var fields = {}, missing = [];
    Object.keys(obj.pola).forEach(function (k) {
      if (!known[k]) return;
      var p = obj.pola[k];
      if (p.kolumna != null) {
        if (table && !cols[p.kolumna]) { if (missing.indexOf(p.kolumna) < 0) missing.push(p.kolumna); return; }
        fields[k] = { src: 'col', col: p.kolumna, tr: p.przeksztalcenie || '' };
      } else if (p.stala != null) fields[k] = { src: 'const', value: String(p.stala) };
      else if (p.generuj != null) fields[k] = { src: 'gen', prefix: String(p.generuj) };
    });
    var values = {};
    Object.keys(obj.wartosci || {}).forEach(function (k) { if (known[k]) values[k] = Object.assign({}, obj.wartosci[k]); });
    return { mapping: { fields: fields, values: values }, missingCols: missing, headerRow: obj.wiersz_naglowka, sheet: obj.arkusz };
  }

  function headerSignature(header) {
    var s = header.map(norm).join('|'), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  var api = {
    norm: norm, nameScore: nameScore, suggestMapping: suggestMapping, transformsFor: transformsFor, TRANSFORMS: TRANSFORMS,
    parseAddress: parseAddress, parseCoords: parseCoords, polishHoursToOsm: polishHoursToOsm, excelSerialToIso: excelSerialToIso,
    suggestValue: suggestValue, readFile: readFile, readXlsx: readXlsx, readJson: readJson, readXml: readXml, gmlPointToWgs: gmlPointToWgs, tableFromMatrix: tableFromMatrix,
    guessHeaderRow: guessHeaderRow, buildRows: buildRows, unknownValues: unknownValues, previewField: previewField,
    exportMapping: exportMapping, importMapping: importMapping, headerSignature: headerSignature, colLetter: colLetter
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AedMapper = api;
})(this);
