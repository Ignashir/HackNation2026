// node --test konwerter/test/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const W = require('../src/walidator.js');
const S = require('../standard/aed_standard_v2.json');
const M = require('../src/mapper.js');
const T = '2026-11-22';
const file = (f) => path.join(__dirname, '..', f);

async function convert(f, extra) {
  const r = await M.readFile(f, fs.readFileSync(file(f)), W);
  const sheet = r.sheets.find((s) => s.matrix.length > 1) || r.sheets[0];
  const t = M.tableFromMatrix(sheet.matrix);
  const s = M.suggestMapping(S, t);
  const mapping = { fields: Object.assign(s.fields, extra || {}), values: {} };
  for (const fl of S.fields) for (const u of M.unknownValues(S, t, mapping, fl, W)) {
    if (u.suggestion) (mapping.values[fl.name] = mapping.values[fl.name] || {})[u.raw] = u.suggestion;
  }
  const b = M.buildRows(S, t, mapping);
  return { t, s, mapping, res: W.validate(S, { header: b.header, rows: b.rows }, { today: T }) };
}

test('przykładowy rejestr gminy: auto-dopasowanie kolumn', async () => {
  const { s, t } = await convert('przyklady/rejestr_gminy_przyklad.csv');
  assert.strictEqual(t.rows.length, 10);
  assert.deepStrictEqual(s.fields.postcode, { src: 'col', col: 'Adres', tr: 'adres_kod' });
  assert.deepStrictEqual(s.fields.lat, { src: 'col', col: 'Współrzędne GPS', tr: 'wsp_szer' });
  assert.strictEqual(s.fields.operator.col, 'Jednostka');
  assert.strictEqual(s.fields.is_24_7.tr, 'z_godzin');
});

test('przykładowy rejestr gminy: po uzupełnieniu stałych większość wierszy gotowa', async () => {
  const { res } = await convert('przyklady/rejestr_gminy_przyklad.csv', { status: { src: 'const', value: 'active' } });
  const r1 = res.records[0].values;
  assert.strictEqual(r1.opening_hours, '24/7');
  assert.strictEqual(r1.is_24_7, 'tak');
  assert.strictEqual(r1.lat, '50.06170');
  assert.strictEqual(res.records[1].values.opening_hours, 'Mo-Fr 07:00-19:00; Sa 08:00-14:00');
  assert.strictEqual(res.records[4].values.lat, '50.0633'); // zamienione współrzędne poprawione
  assert.ok(res.summary.valid >= 7, 'gotowe: ' + res.summary.valid);
});

test('XLSX: arkusz z tytułem, daty z formatem, kod pocztowy jako liczba', async () => {
  const { res, t } = await convert('test/przyklad.xlsx');
  assert.strictEqual(t.headerRow, 2);
  const v = res.records[0].values;
  assert.strictEqual(v.last_verified, '2026-11-03');
  assert.strictEqual(v.postcode, '31-154');
  assert.strictEqual(v.is_24_7, 'tak');
  assert.strictEqual(res.records[0].issues.filter((i) => i.severity === 'error').length, 0);
});

test('GeoJSON z OSM: tagi i geometria', async () => {
  const { res } = await convert('test/przyklad.geojson');
  const v = res.records[0].values;
  assert.strictEqual(v.lat, '50.06143');
  assert.strictEqual(v.indoor, 'tak');
  assert.strictEqual(v.access, 'yes');
});

test('przekształcenia pomocnicze', () => {
  assert.deepStrictEqual(M.parseAddress('31-019 Kraków, ul. Floriańska 12/4'), { ulica: 'ul. Floriańska', numer: '12/4', kod: '31-019', miejscowosc: 'Kraków' });
  assert.strictEqual(M.parseAddress('Borek 12, 32-051 Borek').ulica, '');
  assert.strictEqual(M.polishHoursToOsm('Pn.–Pt. 8:00–16:00; Sob. nieczynne'), 'Mo-Fr 08:00-16:00; Sa off');
  assert.strictEqual(M.polishHoursToOsm('codziennie 6-23'), 'Mo-Su 06:00-23:00');
  assert.deepStrictEqual(M.parseCoords('POINT(19.93 50.06)'), { lat: '50.06', lon: '19.93' });
  assert.strictEqual(M.excelSerialToIso(46329), '2026-11-03');
});

test('mapowanie: zapis i odczyt', async () => {
  const { t, mapping } = await convert('przyklady/rejestr_gminy_przyklad.csv', { status: { src: 'const', value: 'active' } });
  const back = M.importMapping(S, JSON.parse(JSON.stringify(M.exportMapping(S, t, mapping))), t);
  assert.deepStrictEqual(back.mapping.fields.status, { src: 'const', value: 'active' });
  assert.deepStrictEqual(back.mapping.fields.street, mapping.fields.street);
  assert.deepStrictEqual(back.missingCols, []);
});

test('XML: lista rekordów z zagnieżdżeniem i atrybutami', async () => {
  const { res, t } = await convert('test/przyklad.xml');
  assert.strictEqual(t.rows.length, 2);
  const v = res.records[0].values;
  assert.strictEqual(v.aed_id, 'SP-01');
  assert.strictEqual(v.lat, '50.06210');
  assert.strictEqual(v.postcode, '32-050');
  assert.strictEqual(v.access, 'customers');
  assert.strictEqual(v.opening_hours, 'Mo-Fr 07:30-15:30');
  assert.strictEqual(v.placement, 'Parter, hol główny, obok punktu informacji & kancelarii');
});

test('KML: Placemark, współrzędne i ExtendedData', async () => {
  const { res } = await convert('test/przyklad.kml');
  const v = res.records[0].values;
  assert.strictEqual(v.lat, '50.05900');
  assert.strictEqual(v.lon, '19.82500');
  assert.strictEqual(v.contact_phone, '12 000 00 21');
  assert.strictEqual(v.opening_hours, 'Mo-Su 05:00-23:00');
});

test('Excel 2003 XML w Windows-1250', async () => {
  const { res } = await convert('test/przyklad_excel2003.xml');
  const v = res.records[0].values;
  assert.strictEqual(v.name, 'PRZYKŁAD · Hala');
  assert.strictEqual(v.last_verified, '2026-11-10');
  assert.strictEqual(v.lat, '50.06111');
});

test('GML (WFS 2.0, PUWG 1992 w zapisie urn) i GML 2 (PUWG 2000 strefa 7)', async () => {
  const a = await convert('test/przyklad.gml');
  const v = a.res.records[0].values;
  assert.strictEqual(v.aed_id, 'WAW-001');
  assert.strictEqual(v.lat, '52.231667');
  assert.strictEqual(v.lon, '21.006389');
  assert.strictEqual(v.placement, 'Hol główny, przy szatni');
  const b = await convert('test/przyklad_gml2.gml');
  assert.strictEqual(b.res.records[1].values.lat, '50.061430');
  assert.strictEqual(b.res.records[1].values.lon, '19.936580');
});

test('przeliczenie PUWG 1992 i 2000 na WGS 84 (wzorce z PROJ)', () => {
  const cases = [['EPSG:2180', 636979.445, 486964.893, 52.231667, 21.006389], ['urn:ogc:def:crs:EPSG::2176', 5922113.508, 5470091.654, 53.43, 14.55],
    ['EPSG:2177', 6638652.274, 5549049.632, 50.06143, 19.93658], ['EPSG:2179', 8443779.159, 5888963.996, 53.13, 23.16]];
  for (const [srs, a, b, lat, lon] of cases) {
    const r = M.gmlPointToWgs(a, b, srs);
    assert.ok(Math.abs(r.lat - lat) < 1e-5 && Math.abs(r.lon - lon) < 1e-5, srs + ' ' + JSON.stringify(r));
  }
});

test('standard 2.0: 4 pola wymagane, reszta nie blokuje', () => {
  const req = S.fields.filter((f) => f.level === 'wymagane').map((f) => f.name);
  assert.deepStrictEqual(req, ['aed_id', 'lat', 'lon', 'name']);
  const res = W.validate(S, { header: ['aed_id', 'lat', 'lon', 'name'], rows: [['KRO-0001', '49.718809', '21.720344', 'Zespół Krytych Pływalni']] }, { today: T });
  assert.strictEqual(res.summary.valid, 1);
  const bad = W.validate(S, { header: ['aed_id', 'lat', 'lon', 'name'], rows: [['KRO 1', '49.7', '21.7', 'X']] }, { today: T });
  const f = bad.records[0].issues.filter((i) => i.severity === 'error').map((i) => i.field);
  assert.ok(f.includes('aed_id') && f.includes('name'));
});

test('standard 2.0: same_as, udi_di i ta sama tożsamość urządzenia', () => {
  const h = ['aed_id', 'lat', 'lon', 'name', 'manufacturer', 'model', 'serial_number', 'udi_di', 'same_as'];
  const res = W.validate(S, { header: h, rows: [
    ['A-1', '49.71880', '21.72034', 'Basen', 'Philips', 'FRx', 'B21G-1', '00884838034567', '000526989:5;osm:node/4419237512'],
    ['A-2', '49.71881', '21.72035', 'Basen 2', 'Philips', 'FRx', 'B21G-2', '123', 'osm:4419'],
    ['A-3', '49.71882', '21.72036', 'Basen 3', 'philips', 'FRx', 'b21g-1', '', '']] }, { today: T });
  assert.strictEqual(res.records[0].issues.filter((i) => i.severity === 'error').length, 0);
  const e2 = res.records[1].issues.filter((i) => i.severity === 'error').map((i) => i.field);
  assert.ok(e2.includes('udi_di') && e2.includes('same_as'));
  assert.ok(res.records[2].issues.some((i) => i.severity === 'error' && /To samo urządzenie/.test(i.message)));
});
