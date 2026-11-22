/* Konwerter AEDane: interfejs kreatora. Wymaga AED_STANDARD, AED_PRZYKLAD_WEJSCIE, AedWalidator, AedMapper. */
(function () {
  'use strict';
  var S = AED_STANDARD, W = AedWalidator, M = AedMapper;
  var FIELDS = S.fields, F = {};
  FIELDS.forEach(function (f) { F[f.name] = f; });
  var LS = 'aedane-konwerter:';
  var PAGE = 10;

  // Proste objaśnienia pól dla osób bez przygotowania technicznego.
  var HELP = {
    aed_id: 'Stały numer urządzenia z Twojego rejestru, np. numer ewidencyjny. Każde urządzenie musi mieć inny i nie wolno go potem użyć dla innego urządzenia. Jeśli go nie masz, wybierz „Nadaj numery automatycznie”.',
    lat: 'Położenie AED na mapie, np. 49.718809. Znajdziesz je w mapach Google: kliknij prawym przyciskiem myszy na budynek, a pierwsza liczba to szerokość.',
    lon: 'Druga współrzędna położenia, np. 21.720344. Jeśli obie liczby są w jednej kolumnie, wybierz ją tutaj i w polu wyżej.',
    name: 'Nazwa, którą ludzie zobaczą na mapie, np. Zespół Krytych Pływalni.',
    address: 'Cały adres w jednym polu, np. ul. Jasna 1, 38-400 Krosno. Jeśli masz adres w kilku kolumnach, złożymy go sami.',
    street: 'Z przedrostkiem, np. ul. Jasna. Jeśli cały adres jest w jednej kolumnie, wybierz ją, a my wyciągniemy z niej ulicę.',
    house_number: 'Np. 5A.',
    postcode: 'Np. 38-400.',
    city: 'Np. Krosno.',
    teryt: '7-cyfrowy kod gminy z rejestru TERYT (TERC), np. 1861011. Można go pominąć.',
    placement: 'Gdzie dokładnie wisi AED, np. „Hol główny przy recepcji”. Pisz tak, jakby czytał to ktoś, kto jest tam pierwszy raz.',
    indoor: 'Czy AED wisi w środku budynku (tak), czy na zewnątrz (nie).',
    access: 'Kto może skorzystać z urządzenia.',
    is_24_7: 'Czy z AED można skorzystać o każdej porze dnia i nocy. Jeśli masz kolumnę z godzinami, wyliczymy to z niej.',
    opening_hours: 'Kiedy AED jest dostępny. Mogą być zapisane po polsku, np. „pn-pt 8-16”. Zamienimy je na wymagany zapis.',
    cabinet_locked: 'Czy szafka z AED jest zamknięta (na kod, klucz).',
    status: 'Czy urządzenie działa. Jeśli wszystkie działają, wybierz „Ta sama odpowiedź dla wszystkich” i „Sprawny i na miejscu”.',
    last_verified: 'Kiedy ktoś ostatnio sprawdził na miejscu, że AED tam jest. Jeśli sprawdzono wszystkie dziś, wybierz „Ta sama odpowiedź dla wszystkich”.',
    serial_number: 'Z tabliczki na urządzeniu. Razem z producentem i modelem pozwala rozpoznać to samo urządzenie w różnych rejestrach.',
    udi_di: '14 cyfr z etykiety urządzenia, oznaczonych (01). Pomaga połączyć dane z różnych rejestrów.',
    operator: 'Kto opiekuje się urządzeniem na miejscu, np. Zespół Krytych Pływalni w Krośnie.',
    contact_phone: 'Numer instytucji, nie prywatny numer pracownika.',
    same_as: 'Jeśli to urządzenie jest już w innym rejestrze lub w OpenStreetMap, wpisz jego oznaczenie, np. osm:node/4419237512. Dzięki temu nie pojawi się na mapie dwa razy.'
  };
  var BOOL_LABEL = { indoor: ['tak, w środku budynku', 'nie, na zewnątrz'], is_24_7: ['tak, całą dobę', 'nie, w określonych godzinach'], cabinet_locked: ['tak, zamknięta', 'nie, otwarta'], paediatric_capable: ['tak', 'nie'] };

  var state = {
    file: null, sheet: 0, headerRow: null, table: null, isSample: false,
    mapping: { fields: {}, values: {} }, meta: {}, overrides: {},
    result: null, stats: null, step: 1, maxStep: 1, page: 0, vmapFields: []
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function plural(n, one, few, many) { var a = Math.abs(n) % 100, b = a % 10; return n === 1 ? one : (b >= 2 && b <= 4 && (a < 12 || a > 14)) ? few : many; }
  function nf(n) { return n.toLocaleString('pl-PL'); }
  function cut(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function lsGet(k) { try { var v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { /* brak pamięci przeglądarki */ } }
  var toastT;
  function toast(m) { var t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3200); }
  var recomputeT;
  function schedule() { clearTimeout(recomputeT); recomputeT = setTimeout(recompute, 150); }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function enumLabel(f, code) { if (f.type === 'boolean') return boolLabel(f, code); var e = (f.enum || []).filter(function (x) { return x.code === code; })[0]; return e ? e.label : code; }
  function boolLabel(f, v) { var l = BOOL_LABEL[f.name] || ['tak', 'nie']; return v === 'tak' ? l[0] : v === 'nie' ? l[1] : v; }
  function choiceOptions(f, cur, emptyText) {
    var opts = f.type === 'boolean' ? [['tak', boolLabel(f, 'tak')], ['nie', boolLabel(f, 'nie')]] : f.enum.map(function (e) { return [e.code, e.label]; });
    return '<option value="">' + esc(emptyText || 'wybierz…') + '</option>' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function showValue(f, v) { return (f.type === 'enum' || f.type === 'boolean') ? enumLabel(f, v) : v; }

  // ---------- kroki ----------

  function hasVmaps() { return state.vmapFields.length > 0; }
  function go(n) {
    if (n > 1 && !state.table) return;
    if (n === 3 && !hasVmaps()) n = state.step < 3 ? 4 : 2;
    state.step = n; state.maxStep = Math.max(state.maxStep, n);
    for (var i = 1; i <= 5; i++) $('step' + i).hidden = i !== n;
    renderStepper();
    if (n === 4) renderCheck();
    if (n === 5) renderExport();
    var top = document.querySelector('nav[aria-label="Postęp"]');
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' });
    var h = $('step' + n).querySelector('h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  function renderStepper() {
    document.querySelectorAll('#stepper li').forEach(function (li) {
      var s = Number(li.dataset.s), b = li.querySelector('button');
      li.className = s === state.step ? 'cur' : (s === 3 && state.table && !hasVmaps()) ? 'skip' : s < state.maxStep || (s <= state.maxStep && s !== state.step) ? 'done' : '';
      b.disabled = !state.table || s > state.maxStep + (state.table ? 1 : 0);
      if (s === state.step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]'); if (!b || b.disabled) return;
    go(Number(b.dataset.go));
  });

  // ---------- krok 1: wczytanie ----------

  function loadBytes(name, bytes, isSample) {
    $('load-error').hidden = true;
    return M.readFile(name, bytes, W).then(function (f) {
      if (!f.sheets.length) throw new Error('W pliku nie ma żadnej tabeli z danymi.');
      f.name = name;
      state.file = f; state.isSample = !!isSample; state.overrides = {}; state.page = 0; state.maxStep = 1;
      state.sheet = 0;
      for (var i = 0; i < f.sheets.length; i++) if (f.sheets[i].matrix.length > 1) { state.sheet = i; break; }
      state.headerRow = null;
      if (isSample && !$('meta-org').value) $('meta-org').value = 'PRZYKŁAD · Urząd Gminy';
      buildTable();
    }).catch(function (e) {
      $('load-error').innerHTML = '<b class="t">Nie udało się wczytać pliku „' + esc(name) + '”.</b><span>' + esc(e && e.message ? e.message : e) + '</span>';
      $('load-error').hidden = false;
    });
  }

  function buildTable() {
    var sh = state.file.sheets[state.sheet];
    state.table = M.tableFromMatrix(sh.matrix, state.headerRow);
    state.headerRow = state.table.headerRow;
    state.overrides = {};
    renderLoaded();
    applyInitialMapping();
    renderStepper();
  }

  function renderLoaded() {
    var f = state.file, t = state.table;
    $('loaded').hidden = false;
    $('sample-note').hidden = !state.isSample;
    $('loaded-title').textContent = 'Wczytano plik ' + f.name;
    $('loaded-text').textContent = 'Znaleźliśmy ' + nf(t.rows.length) + ' ' + plural(t.rows.length, 'wiersz', 'wiersze', 'wierszy') + ' (urządzeń) i ' + t.header.length + ' ' + plural(t.header.length, 'kolumnę', 'kolumny', 'kolumn') + '.' +
      (/PUWG|Mercator/.test(f.kind) ? ' Współrzędne przeliczyliśmy na stopnie (' + f.kind.replace(/^GML, współrzędne z /, '').replace(/ przeliczone.*$/, '') + ').' : '');
    var multi = f.sheets.length > 1;
    $('sheet-wrap').hidden = !multi;
    $('sheet-label').textContent = /XML|KML|GML/.test(f.kind) && !/Excel/.test(f.kind) ? 'Które elementy wczytać?' : 'Który arkusz wczytać?';
    $('sheet').innerHTML = f.sheets.map(function (s, i) { var n = Math.max(0, s.matrix.length - 1); return '<option value="' + i + '"' + (i === state.sheet ? ' selected' : '') + '>' + esc(s.name) + ' (' + n + ' ' + plural(n, 'wiersz', 'wiersze', 'wierszy') + ')</option>'; }).join('');
    $('header-row').value = state.headerRow + 1;
    $('header-row').max = Math.max(1, f.sheets[state.sheet].matrix.length);
    var head = '<thead><tr>' + t.header.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead>';
    var body = t.rows.slice(0, 5).map(function (r) { return '<tr>' + r.map(function (v) { return '<td title="' + esc(v) + '">' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('');
    $('preview').innerHTML = head + '<tbody>' + body + '</tbody>';
    $('next1').disabled = !t.rows.length;
    $('hint1').textContent = t.rows.length ? 'Gotowe. Przejdź dalej, żeby wskazać kolumny.' : 'Ta tabela nie ma wierszy z danymi. Sprawdź, w którym wierszu są nazwy kolumn.';
    if (!t.rows.length) $('adv').open = true;
  }

  function applyInitialMapping() {
    var t = state.table, sig = M.headerSignature(t.header), saved = state.isSample ? null : lsGet('map:' + sig), msg = '';
    if (saved) {
      try {
        var im = M.importMapping(S, saved, t);
        state.mapping = im.mapping; state.meta = {};
        Object.keys(state.mapping.fields).forEach(function (k) { state.meta[k] = { score: 1, why: 'z zapisanych ustawień' }; });
        msg = 'Ta tabela ma taki sam układ jak poprzednio. Użyliśmy ustawień zapisanych ' + new Date(saved.zapisano).toLocaleDateString('pl-PL') + '.';
      } catch (e) { saved = null; }
    }
    if (!saved) {
      var s = M.suggestMapping(S, t);
      state.mapping = { fields: s.fields, values: {} }; state.meta = s.meta;
      prefillValueSuggestions();
    }
    $('map-note').textContent = msg; $('map-note').hidden = !msg;
    renderCards();
    renderValueMaps();
    recompute();
  }

  function prefillValueSuggestions() {
    FIELDS.forEach(function (f) {
      if (f.type !== 'enum' && f.type !== 'boolean') return;
      var list = M.unknownValues(S, state.table, state.mapping, f, W);
      if (!list.length) return;
      var vm = state.mapping.values[f.name] = state.mapping.values[f.name] || {};
      list.forEach(function (u) { if (vm[u.raw] === undefined && u.suggestion) vm[u.raw] = u.suggestion; });
    });
  }

  // ---------- krok 2: karty pól ----------

  function isMapped(f) {
    var spec = state.mapping.fields[f.name];
    return !!(spec && spec.src && spec.src !== 'none' && !(spec.src === 'const' && (spec.value == null || spec.value === '')));
  }
  function isNeeded(f) {
    if (f.level !== 'wymagane' || isMapped(f)) return false;
    return true;
  }

  function renderCards() {
    var html = { wymagane: '', zalecane: '', opcjonalne: '' };
    FIELDS.forEach(function (f) { html[f.level] += '<div class="card" id="c-' + f.name + '" data-field="' + f.name + '"></div>'; });
    $('cards-req').innerHTML = html.wymagane; $('cards-rec').innerHTML = html.zalecane; $('cards-opt').innerHTML = html.opcjonalne;
    FIELDS.forEach(renderCard);
  }

  function columnOptions(f, spec) {
    var cur = spec && spec.src === 'col' ? spec.col : null, t = state.table, o = '';
    o += '<option value="none">' + (f.level === 'wymagane' ? 'Nie mam tych danych w tabeli' : 'Nie podawaj') + '</option>';
    o += '<optgroup label="Kolumny z Twojej tabeli">';
    t.header.forEach(function (h, i) {
      var ex = ''; for (var r = 0; r < t.rows.length && !ex; r++) ex = (t.rows[r][i] || '').trim();
      o += '<option value="c:' + i + '"' + (h === cur ? ' selected' : '') + '>' + esc(cut(h, 40)) + (ex ? ' – np. ' + esc(cut(ex, 32)) : '') + '</option>';
    });
    o += '</optgroup><optgroup label="Inne możliwości">';
    o += '<option value="const"' + (spec && spec.src === 'const' ? ' selected' : '') + '>Ta sama odpowiedź dla wszystkich urządzeń</option>';
    if (f.name === 'aed_id') o += '<option value="gen"' + (spec && spec.src === 'gen' ? ' selected' : '') + '>Nadaj numery automatycznie</option>';
    return o + '</optgroup>';
  }

  function constInput(f, value) {
    var id = 'k-' + f.name, v = value == null ? '' : value, lab = '<label class="lbl" for="' + id + '">Odpowiedź dla wszystkich</label>';
    if (f.type === 'enum' || f.type === 'boolean') return lab + '<select id="' + id + '" data-k>' + choiceOptions(f, v) + '</select>';
    if (f.type === 'date') return lab + '<input type="date" id="' + id + '" data-k value="' + esc(v) + '">';
    return lab + '<input type="text" id="' + id + '" data-k value="' + esc(v) + '" placeholder="np. ' + esc(f.example || '') + '">';
  }

  function renderCard(f) {
    var card = $('c-' + f.name), spec = state.mapping.fields[f.name], help = HELP[f.name] || f.description || '';
    if (!help && f.example) help = 'Np. ' + f.example + '.';
    var cfg = '';
    if (spec && spec.src === 'col') {
      var trs = M.transformsFor(f.name);
      if (trs.length) cfg = '<label class="lbl" for="t-' + f.name + '">Którą część tej kolumny wziąć?</label><select id="t-' + f.name + '" data-tr><option value="">całą zawartość</option>' + trs.map(function (k) { return '<option value="' + k + '"' + (spec.tr === k ? ' selected' : '') + '>' + esc(M.TRANSFORMS[k].label) + '</option>'; }).join('') + '</select>';
    } else if (spec && spec.src === 'const') cfg = constInput(f, spec.value);
    else if (spec && spec.src === 'gen') cfg = '<label class="lbl" for="p-' + f.name + '">Początek numeru</label><input type="text" id="p-' + f.name + '" data-prefix value="' + esc(spec.prefix || 'AED-') + '">';
    card.innerHTML =
      '<div class="ch"><h3>' + esc(f.label) + '</h3><span class="badge" data-badge></span></div>' +
      (help ? '<p class="help">' + esc(help) + '</p>' : '') +
      '<div class="' + (cfg ? 'grid2' : '') + '"><div><label class="lbl" for="s-' + f.name + '">Skąd wziąć te dane?</label><select id="s-' + f.name + '" data-src>' + columnOptions(f, spec) + '</select></div>' + (cfg ? '<div>' + cfg + '</div>' : '') + '</div>' +
      '<div class="result" data-result hidden></div>';
    renderResult(f); renderBadge(f);
  }

  function renderResult(f) {
    var card = $('c-' + f.name), el = card.querySelector('[data-result]'), spec = state.mapping.fields[f.name];
    if (!spec || !spec.src || spec.src === 'none') { el.hidden = true; return; }
    var vals = M.previewField(S, state.table, state.mapping, f, 3);
    el.hidden = false;
    el.innerHTML = vals.length ? 'Do pliku trafi np.: ' + vals.map(function (v) { return '<b>' + esc(cut(showValue(f, v), 60)) + '</b>'; }).join(', ') : '<span class="muted">Ta kolumna jest pusta.</span>';
  }

  function renderBadge(f) {
    var card = $('c-' + f.name), b = card.querySelector('[data-badge]'), spec = state.mapping.fields[f.name], m = state.meta[f.name];
    var s = state.stats ? state.stats[f.name] : { e: 0 }, cls, txt;
    var low = isMapped(f) && spec.src === 'col' && m && m.score < 0.8;
    if (isNeeded(f)) { cls = 'err'; txt = 'Brak danych'; }
    else if (!isMapped(f)) { cls = 'off'; txt = f.level === 'zalecane' ? 'Warto uzupełnić' : 'Nie podano'; }
    else if (s.e) { cls = 'err'; txt = s.e + ' ' + plural(s.e, 'błąd', 'błędy', 'błędów'); }
    else if (low) { cls = 'warn'; txt = 'Sprawdź, czy dobrze'; }
    else { cls = 'ok'; txt = '✓ Gotowe'; }
    b.className = 'badge ' + cls; b.textContent = txt;
    card.classList.toggle('need', cls === 'err');
    card.classList.toggle('check', cls === 'warn');
  }

  function renderReqProgress() {
    var req = FIELDS.filter(function (f) { return f.level === 'wymagane'; }), missing = req.filter(isNeeded);
    var done = req.length - missing.length;
    $('req-progress-text').textContent = 'Dane obowiązkowe: ' + done + ' z ' + req.length;
    $('req-progress-sub').textContent = missing.length ? 'Brakuje ' + missing.length : 'Komplet';
    $('req-meter').innerHTML = '<i class="ok" style="width:' + (done / req.length * 100) + '%"></i>';
    $('hint2').textContent = missing.length ? 'Brakuje: ' + missing.map(function (f) { return f.label; }).join(', ') + '. Bez nich żadne urządzenie nie będzie gotowe.' : '';
    var recAll = FIELDS.filter(function (f) { return f.level === 'zalecane'; }), recDone = recAll.filter(isMapped).length;
    $('rec-progress').textContent = 'podano ' + recDone + ' z ' + recAll.length;
    var optAll = FIELDS.filter(function (f) { return f.level === 'opcjonalne'; }), optDone = optAll.filter(isMapped).length;
    $('opt-title').textContent = 'Dane opcjonalne: podano ' + optDone + ' z ' + optAll.length;
  }

  function onCardChange(e) {
    var card = e.target.closest('.card[data-field]'); if (!card) return;
    var f = F[card.dataset.field], spec = state.mapping.fields[f.name] || {};
    if (e.target.hasAttribute('data-src')) {
      var v = e.target.value;
      if (v === 'none') delete state.mapping.fields[f.name];
      else if (v === 'const') state.mapping.fields[f.name] = { src: 'const', value: f.name === 'last_verified' ? todayIso() : '' };
      else if (v === 'gen') state.mapping.fields[f.name] = { src: 'gen', prefix: 'AED-' };
      else {
        var col = state.table.header[Number(v.slice(2))], trs = M.transformsFor(f.name), keep = spec.src === 'col' && trs.indexOf(spec.tr) >= 0 ? spec.tr : '';
        state.mapping.fields[f.name] = { src: 'col', col: col, tr: keep };
      }
      state.meta[f.name] = { score: 1, why: 'wybrane ręcznie' };
      renderCard(f);
      if (f.type === 'enum' || f.type === 'boolean') { prefillValueSuggestions(); renderValueMaps(); }
      var k = card.querySelector('[data-k]'); if (k) k.focus(); else card.querySelector('[data-src]').focus();
    } else if (e.target.hasAttribute('data-tr')) {
      spec.tr = e.target.value; renderResult(f);
      if (f.type === 'boolean') { prefillValueSuggestions(); renderValueMaps(); }
    } else if (e.target.hasAttribute('data-k')) { spec.value = e.target.value; renderResult(f); }
    else if (e.target.hasAttribute('data-prefix')) { spec.prefix = e.target.value; renderResult(f); }
    renderBadge(f); renderReqProgress(); saveLocal(); schedule();
  }
  ['cards-req', 'cards-rec', 'cards-opt'].forEach(function (id) {
    $(id).addEventListener('change', onCardChange);
    $(id).addEventListener('input', function (e) { if (e.target.matches('input[data-k], input[data-prefix]')) onCardChange(e); });
  });

  // ---------- krok 3: określenia ----------

  function renderValueMaps() {
    var html = '', fields = [];
    FIELDS.forEach(function (f) {
      if (f.type !== 'enum' && f.type !== 'boolean') return;
      var list = M.unknownValues(S, state.table, state.mapping, f, W);
      if (!list.length) return;
      fields.push(f.name);
      var vm = state.mapping.values[f.name] || {};
      html += '<div class="card" data-field="' + f.name + '"><div class="ch"><h3>' + esc(f.label) + '</h3><span class="badge" data-badge></span></div>' +
        '<p class="help">Kolumna „' + esc(state.mapping.fields[f.name].col) + '”. Co oznaczają te odpowiedzi?</p><div>' +
        list.slice(0, 40).map(function (u, i) {
          var id = 'v-' + f.name + '-' + i;
          return '<div class="vrow"><label class="raw" for="' + id + '">„' + esc(u.raw) + '”<small>' + u.count + ' ' + plural(u.count, 'urządzenie', 'urządzenia', 'urządzeń') + '</small></label>' +
            '<select id="' + id + '" data-raw="' + esc(u.raw) + '">' + choiceOptions(f, vm[u.raw] || '', 'wybierz, co to znaczy…') + '</select></div>';
        }).join('') + '</div>' + (list.length > 40 ? '<p class="muted">Są jeszcze ' + (list.length - 40) + ' inne odpowiedzi. Ujednolić je najlepiej w tabeli.</p>' : '') + '</div>';
    });
    state.vmapFields = fields;
    $('vmaps').innerHTML = html;
    fields.forEach(vmapBadge);
    renderStepper();
  }
  function vmapBadge(name) {
    var card = $('vmaps').querySelector('.card[data-field="' + name + '"]'); if (!card) return;
    var todo = Array.prototype.filter.call(card.querySelectorAll('select[data-raw]'), function (s) { return !s.value; }).length;
    var b = card.querySelector('[data-badge]');
    b.className = 'badge ' + (todo ? 'err' : 'ok'); b.textContent = todo ? 'Do wyboru: ' + todo : '✓ Gotowe';
    card.classList.toggle('need', !!todo);
    var all = Array.prototype.reduce.call($('vmaps').querySelectorAll('select[data-raw]'), function (n, s) { return n + (s.value ? 0 : 1); }, 0);
    $('hint3').textContent = all ? 'Zostało do wyboru: ' + all + '. Urządzenia z niewyjaśnionymi odpowiedziami będą miały błąd.' : '';
  }
  $('vmaps').addEventListener('change', function (e) {
    var sel = e.target.closest('select[data-raw]'); if (!sel) return;
    var f = sel.closest('.card').dataset.field, vm = state.mapping.values[f] = state.mapping.values[f] || {};
    vm[sel.dataset.raw] = sel.value;
    vmapBadge(f); saveLocal(); schedule();
  });

  // ---------- walidacja ----------

  function counts(r) {
    var e = 0, w = 0, i = 0;
    r.issues.forEach(function (x) { if (x.severity === 'error') e++; else if (x.severity === 'warning') w++; else i++; });
    return { e: e, w: w, i: i };
  }
  function fieldStats() {
    var st = {};
    FIELDS.forEach(function (f) { st[f.name] = { e: 0, w: 0, rows: 0, top: {} }; });
    state.result.records.forEach(function (r) {
      var seen = {};
      r.issues.forEach(function (i) {
        if (!i.field || !st[i.field] || i.severity !== 'error') return;
        var s = st[i.field]; s.e++;
        if (!seen[i.field]) { s.rows++; seen[i.field] = true; }
        var key = i.message.replace(/„[^”]*”/g, '„…”').replace(/\d{4}-\d{2}-\d{2}/g, 'D').replace(/wiersz(u)? \d+/g, 'wiersz').replace(/\b\d+(\.\d+)?\b/g, 'N');
        s.top[key] = s.top[key] || { n: 0, ex: i.message }; s.top[key].n++;
      });
    });
    return st;
  }

  function recompute() {
    if (!state.table) return;
    var b = M.buildRows(S, state.table, state.mapping, state.overrides);
    var res = W.validate(S, { header: b.header, rows: b.rows }, {});
    res.records.forEach(function (r, i) {
      r.ri = i; r.line = state.table.lines[i];
      r.issues = b.notes[i].concat(r.issues);
      r.cells = b.rows[i];
    });
    state.result = res; state.stats = fieldStats();
    FIELDS.forEach(renderBadge);
    renderReqProgress();
    if (state.step === 4) renderCheck();
    if (state.step === 5) renderExport();
  }

  // ---------- krok 4: sprawdzenie ----------

  function renderCheck() {
    var res = state.result, s = res.summary;
    $('res-title').textContent = s.rows ? (s.valid === s.rows ? 'Wszystkie ' + nf(s.rows) + ' ' + plural(s.rows, 'urządzenie jest gotowe', 'urządzenia są gotowe', 'urządzeń jest gotowych') + '.'
      : nf(s.valid) + ' z ' + nf(s.rows) + ' ' + plural(s.rows, 'urządzenia', 'urządzeń', 'urządzeń') + ' gotowych do publikacji.') : 'Tabela nie ma danych.';
    var pOk = s.rows ? s.valid / s.rows * 100 : 0;
    $('res-meter').innerHTML = '<i class="ok" style="width:' + pOk + '%"></i><i class="err" style="width:' + (100 - pOk) + '%"></i>';
    $('res-sub').textContent = s.withErrors ? nf(s.withErrors) + ' ' + plural(s.withErrors, 'urządzenie ma', 'urządzenia mają', 'urządzeń ma') + ' błędy do poprawienia.' : 'Nie ma błędów do poprawienia.';
    $('hint4').textContent = s.withErrors ? 'Możesz przejść dalej. Urządzenia z błędami nie trafią do pliku.' : '';

    // błędy wspólne dla wielu urządzeń: lepiej poprawić w kroku 2 albo w tabeli
    var common = FIELDS.filter(function (f) { return state.stats[f.name].rows >= Math.max(3, s.rows * 0.3); });
    if (common.length) {
      $('res-common').innerHTML = '<b class="t">Te same błędy powtarzają się w wielu urządzeniach</b><ul class="plain">' + common.map(function (f) {
        var st = state.stats[f.name];
        var top = Object.keys(st.top).map(function (k) { return st.top[k]; }).sort(function (a, b) { return b.n - a.n; })[0];
        return '<li><b>' + esc(f.label) + '</b> (' + st.rows + ' ' + plural(st.rows, 'urządzenie', 'urządzenia', 'urządzeń') + '): ' + esc(top.ex) + '</li>';
      }).join('') + '</ul><span>Szybciej będzie wskazać inną kolumnę albo wpisać jedną odpowiedź dla wszystkich. <button class="btn link" type="button" data-go="2">Wróć do kroku 2</button></span>';
      $('res-common').hidden = false;
    } else $('res-common').hidden = true;

    var bad = res.records.filter(function (r) { return counts(r).e; }), pages = Math.max(1, Math.ceil(bad.length / PAGE));
    if (state.page >= pages) state.page = pages - 1;
    $('devs').innerHTML = bad.length ? bad.slice(state.page * PAGE, state.page * PAGE + PAGE).map(deviceCard).join('') :
      (s.rows ? '<div class="note ok"><b class="t">Brak błędów.</b><span>Wszystkie urządzenia spełniają standard. Przejdź dalej, żeby pobrać plik.</span></div>' : '');
    $('pager').innerHTML = pages > 1 ? '<button class="btn" type="button" data-pg="-1"' + (state.page ? '' : ' disabled') + '>Poprzednie</button><span>Strona ' + (state.page + 1) + ' z ' + pages + '</span><button class="btn" type="button" data-pg="1"' + (state.page < pages - 1 ? '' : ' disabled') + '>Następne</button>' : '';

    // uwagi
    var warnRecs = res.records.filter(function (r) { return counts(r).w; }), wn = 0;
    warnRecs.forEach(function (r) { wn += counts(r).w; });
    $('warn-wrap').hidden = !wn;
    $('warn-title').textContent = 'Uwagi do sprawdzenia (' + wn + '), nie blokują publikacji';
    $('warns').innerHTML = warnRecs.slice(0, 50).map(function (r) {
      return '<div class="dev"><div class="dh"><h3>' + esc(r.values.name || 'Urządzenie bez nazwy') + '</h3><span class="where">wiersz ' + r.line + ' w Twojej tabeli</span></div>' +
        r.issues.filter(function (i) { return i.severity === 'warning'; }).map(function (i) { return '<div class="prob warning"><span class="pm">' + (i.field ? '<b>' + esc(F[i.field].label) + ':</b> ' : '') + esc(i.message) + '</span></div>'; }).join('') + '</div>';
    }).join('') + (warnRecs.length > 50 ? '<p class="muted">Pokazano 50 pierwszych urządzeń. Pełną listę zawiera „Lista błędów” w kroku 5.</p>' : '');

    // automatyczne poprawki
    var fx = {}, fn = 0;
    res.records.forEach(function (r) { r.issues.forEach(function (i) { if (i.severity !== 'info') return; fn++; var k = (i.field ? F[i.field].label + ': ' : '') + i.message.replace(/„[^”]*”/, '„…”').replace(/ (na|jako|w składni OSM:) .*$/, ' $1 …'); fx[k] = (fx[k] || 0) + 1; }); });
    $('fixes-wrap').hidden = !fn;
    $('fixes-title').textContent = 'Co poprawiliśmy automatycznie (' + fn + ')';
    $('fixes').innerHTML = Object.keys(fx).sort(function (a, b) { return fx[b] - fx[a]; }).slice(0, 30).map(function (k) { return '<li>' + esc(k) + ' <span class="muted">(' + fx[k] + '×)</span></li>'; }).join('');
  }

  function deviceCard(r) {
    var errs = r.issues.filter(function (i) { return i.severity === 'error'; });
    return '<div class="dev bad" data-ri="' + r.ri + '"><div class="dh"><h3>' + esc(r.values.name || 'Urządzenie bez nazwy') + '</h3><span class="where">wiersz ' + r.line + ' w Twojej tabeli' + (r.values.aed_id ? ' · ' + esc(r.values.aed_id) : '') + '</span></div>' +
      errs.map(function (i, k) {
        var f = i.field && F[i.field], id = 'fx-' + r.ri + '-' + k, cur = f ? r.cells[FIELDS.indexOf(f)] : '';
        var input = !f ? '' : (f.type === 'enum' || f.type === 'boolean') ? '<select id="' + id + '" data-val>' + choiceOptions(f, cur) + '</select>'
          : '<input type="' + (f.type === 'date' ? 'date' : 'text') + '" id="' + id + '" data-val value="' + esc(f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(cur) ? '' : cur) + '" placeholder="np. ' + esc(f.example || '') + '">';
        return '<div class="prob"><span class="pm">' + (f ? '<b>' + esc(f.label) + ':</b> ' : '') + esc(i.message) + '</span>' +
          (f ? '<label class="lbl" for="' + id + '" style="margin:0">Poprawna wartość</label><div class="fix">' + input + '<button class="btn primary" type="button" data-save="' + f.name + '">Zapisz</button></div>' : '') + '</div>';
      }).join('') + '</div>';
  }

  $('devs').addEventListener('click', function (e) { var b = e.target.closest('[data-save]'); if (b) saveFix(b); });
  $('devs').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.matches('input[data-val]')) { e.preventDefault(); saveFix(e.target.closest('.fix').querySelector('[data-save]')); }
  });
  function saveFix(b) {
    var dev = b.closest('.dev'), ri = Number(dev.dataset.ri), field = b.dataset.save, val = b.closest('.fix').querySelector('[data-val]').value.trim();
    state.overrides[ri] = state.overrides[ri] || {};
    state.overrides[ri][field] = val;
    recompute();
    var still = state.result.records[ri].issues.some(function (i) { return i.field === field && i.severity === 'error'; });
    toast(still ? 'Ta wartość nadal jest niepoprawna. Sprawdź podpowiedź.' : 'Poprawione. Zmień to też w swojej tabeli, żeby błąd nie wrócił.');
  }
  $('pager').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pg]'); if (!b) return;
    state.page += Number(b.dataset.pg); renderCheck(); $('step4').scrollIntoView({ block: 'start' });
  });

  // ---------- krok 5: pobranie ----------

  function slug(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'instytucja'; }
  function exportRecords() { var inc = $('include-bad').checked; return state.result.records.filter(function (r) { return inc || !counts(r).e; }); }
  function orgName() {
    var v = $('meta-org').value.trim(); if (v) return v;
    var c = {}, best = '', n = 0;
    (state.result ? state.result.records : []).forEach(function (r) { var d = r.values.operator; if (d) { c[d] = (c[d] || 0) + 1; if (c[d] > n) { n = c[d]; best = d; } } });
    return best;
  }
  function baseName() { return 'aed_' + slug(orgName() || 'instytucja') + '_' + todayIso(); }

  function renderExport() {
    if (!state.result) return;
    var recs = exportRecords(), n = recs.length, all = state.result.records.length, bad = all - state.result.summary.valid, inc = $('include-bad').checked;
    $('dlbox').classList.toggle('empty', !n);
    $('dl-title').textContent = n ? 'Plik jest gotowy: ' + nf(n) + ' ' + plural(n, 'urządzenie', 'urządzenia', 'urządzeń') : 'Plik nie ma jeszcze żadnego urządzenia';
    $('dl-text').textContent = !n ? 'Żadne urządzenie nie ma kompletu poprawnych danych. Wróć do kroku 2 i uzupełnij brakujące dane.'
      : bad && !inc ? nf(bad) + ' ' + plural(bad, 'urządzenie z błędami zostało pominięte', 'urządzenia z błędami zostały pominięte', 'urządzeń z błędami zostało pominiętych') + '. Możesz je poprawić w kroku 4 i pobrać plik ponownie.'
        : bad ? 'Uwaga: plik zawiera ' + nf(bad) + ' ' + plural(bad, 'urządzenie z błędami', 'urządzenia z błędami', 'urządzeń z błędami') + '.' : 'Wszystkie urządzenia spełniają standard danych AED.';
    $('dl-csv').disabled = !n; $('dl-json').disabled = !n; $('copy-csv').disabled = !n;
    var org = orgName() || '[nazwa instytucji]';
    var cities = Array.from(new Set(recs.map(function (r) { return r.values.city; }).filter(Boolean))).slice(0, 5).join(', ');
    $('meta-out').textContent =
      'Tytuł: Defibrylatory AED – ' + org + '\n' +
      'Opis: Lokalizacje i dostępność automatycznych defibrylatorów zewnętrznych (AED), którymi opiekuje się ' + org + (cities ? ', w miejscowościach: ' + cities : '') +
      '. Liczba urządzeń: ' + n + '. Dane zgodne ze Standardem danych AED w wersji ' + S.version + ' (jeden wiersz = jedno urządzenie).\n' +
      'Kategoria: Zdrowie\n' +
      'Tagi: AED, defibrylator, standard-aed-pl, ratownictwo, pierwsza pomoc\n' +
      'Częstotliwość aktualizacji: ' + $('meta-freq').value + '\n' +
      'Licencja: CC0 1.0 (zalecana) lub CC BY 4.0\n' +
      'Nazwa pliku: ' + baseName() + '.csv';
  }
  ['meta-org', 'meta-freq', 'include-bad'].forEach(function (id) { $(id).addEventListener('input', renderExport); $(id).addEventListener('change', renderExport); });

  var platformDl = null;
  try { if (window.claude && window.claude.use) window.claude.use('downloads').then(function (d) { platformDl = d; }, function () {}); } catch (e) { /* poza claude.ai */ }
  function download(name, text, type) {
    if (platformDl) {
      platformDl.save({ filename: name, data: new Blob([text], { type: type }) }).then(function () { toast('Zapisano plik ' + name); },
        function (e) { toast(e && e.code === 'declined' ? 'Anulowano zapisywanie' : 'Pobieranie nie działa w tym oknie. Użyj „Kopiuj zawartość pliku”.'); });
      return;
    }
    var url = URL.createObjectURL(new Blob([text], { type: type })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    toast('Pobrano plik ' + name + '. Znajdziesz go w folderze Pobrane.');
  }
  $('dl-csv').addEventListener('click', function () { download(baseName() + '.csv', '﻿' + W.toCsv(S, exportRecords()), 'text/csv;charset=utf-8'); });
  $('dl-json').addEventListener('click', function () { download(baseName() + '.json', W.toJson(S, exportRecords(), { dysponent: orgName() || null }), 'application/json'); });
  $('copy-csv').addEventListener('click', function () { copy(W.toCsv(S, exportRecords()), 'zawartość pliku'); });
  $('copy-meta').addEventListener('click', function () { copy($('meta-out').textContent, 'opis zbioru'); });
  $('dl-report').addEventListener('click', function () {
    var lines = ['wiersz_w_tabeli,nazwa_miejsca,pole,rodzaj,opis,wartosc'];
    state.result.records.forEach(function (r) {
      r.issues.forEach(function (i) {
        var cur = i.field && F[i.field] ? r.cells[FIELDS.indexOf(F[i.field])] : '';
        lines.push([r.line, r.values.name || '', i.field ? F[i.field].label : '', { error: 'błąd', warning: 'uwaga', info: 'poprawione automatycznie' }[i.severity], i.message, cur].map(W.csvEscape).join(','));
      });
    });
    download('bledy_' + baseName() + '.csv', '﻿' + lines.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  });
  function mappingJson() { return JSON.stringify(M.exportMapping(S, state.table, state.mapping, { wiersz_naglowka: state.headerRow, arkusz: state.file && state.file.sheets[state.sheet].name }), null, 2) + '\n'; }
  function saveMappingFile() { download('ustawienia_konwertera_' + slug(orgName() || 'aed') + '.json', mappingJson(), 'application/json'); }
  $('dl-map').addEventListener('click', saveMappingFile);
  $('map-save').addEventListener('click', saveMappingFile);
  function copy(text, what) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Skopiowano ' + what); } catch (e) { toast('Zaznacz tekst myszką i skopiuj go ręcznie'); }
      ta.remove();
    }
    try { navigator.clipboard.writeText(text).then(function () { toast('Skopiowano ' + what); }, fallback); } catch (e) { fallback(); }
  }

  // ---------- zapamiętywanie ustawień ----------

  var saveT;
  function saveLocal() {
    if (state.isSample || !state.table) return;
    clearTimeout(saveT);
    saveT = setTimeout(function () { lsSet('map:' + M.headerSignature(state.table.header), M.exportMapping(S, state.table, state.mapping, { wiersz_naglowka: state.headerRow })); }, 400);
  }

  // ---------- zdarzenia ----------

  function readUpload(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () { loadBytes(file.name, new Uint8Array(fr.result), false); };
    fr.onerror = function () { $('load-error').innerHTML = '<b class="t">Nie udało się odczytać pliku.</b>'; $('load-error').hidden = false; };
    fr.readAsArrayBuffer(file);
  }
  $('file').addEventListener('change', function () { readUpload(this.files[0]); this.value = ''; });
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { readUpload(e.dataTransfer.files[0]); });
  $('load-sample').addEventListener('click', function () { loadBytes('przykladowa_tabela_gminy.csv', new TextEncoder().encode(AED_PRZYKLAD_WEJSCIE), true); });
  $('sheet').addEventListener('change', function () { state.sheet = Number(this.value); state.headerRow = null; buildTable(); });
  $('header-row').addEventListener('change', function () {
    var n = Math.max(1, Math.min(Number(this.value) || 1, state.file.sheets[state.sheet].matrix.length));
    state.headerRow = n - 1; buildTable();
  });
  $('map-auto').addEventListener('click', function () {
    var s = M.suggestMapping(S, state.table);
    state.mapping = { fields: s.fields, values: {} }; state.meta = s.meta; state.overrides = {};
    prefillValueSuggestions(); renderCards(); renderValueMaps(); recompute(); saveLocal();
    $('map-note').textContent = 'Dopasowaliśmy kolumny od nowa.'; $('map-note').hidden = false;
  });
  $('map-file').addEventListener('change', function () {
    var file = this.files[0]; this.value = ''; if (!file) return;
    file.text().then(function (txt) {
      var im = M.importMapping(S, JSON.parse(txt), state.table);
      state.mapping = im.mapping; state.meta = {}; state.overrides = {};
      Object.keys(state.mapping.fields).forEach(function (k) { state.meta[k] = { score: 1, why: 'z pliku ustawień' }; });
      prefillValueSuggestions(); renderCards(); renderValueMaps(); recompute(); saveLocal();
      $('map-note').textContent = 'Wczytaliśmy ustawienia z pliku „' + file.name + '”.' + (im.missingCols.length ? ' W tej tabeli nie ma kolumn: ' + im.missingCols.join(', ') + '. Te pola wskaż ręcznie.' : '');
      $('map-note').hidden = false;
    }).catch(function () { toast('To nie jest plik ustawień konwertera'); });
  });
  $('restart').addEventListener('click', function () { go(1); $('file').click(); });

  $('std-ver').textContent = S.version;
  renderStepper();
})();
