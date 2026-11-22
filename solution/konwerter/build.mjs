// Składa konwerter w jeden samodzielny plik HTML (standard, walidator i logika wbudowane).
//   konwerter/index.html        do otwarcia z dysku, działa bez internetu
//   FRAGMENT_OUT=plik.html      wersja bez <html>/<head> do publikacji jako Artifact
// Standard: konwerter/standard/aed_standard_v2.json, walidator: konwerter/src/walidator.js.
// Uruchom: node build.mjs (w katalogu solution/konwerter)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const p = (...a) => path.join(dir, ...a);
const read = (...a) => fs.readFileSync(p(...a), 'utf8');
const std = JSON.parse(read('standard', 'aed_standard_v2.json'));
// sygnet AEDane (kopia z aedane-kampania/logo/aedane-sygnet.svg)
const sygnet = read('src', 'sygnet.svg').replace(/<\?xml[^>]*>\s*/, '').replace(/<metadata[\s\S]*?<\/metadata>/g, '')
  .replace(/\srole="img"/, '').replace(/\saria-label="[^"]*"/, '').replace('<svg ', '<svg aria-hidden="true" ');

const html = read('src', 'konwerter.template.html')
  .replace('<!--@@SYGNET@@-->', () => sygnet)
  .replace('/*@@STANDARD@@*/', () => 'var AED_STANDARD = ' + JSON.stringify(std) + ';\nvar AED_PRZYKLAD_WEJSCIE = ' + JSON.stringify(read('przyklady', 'rejestr_gminy_przyklad.csv')) + ';')
  .replace('/*@@WALIDATOR@@*/', () => read('src', 'walidator.js'))
  .replace('/*@@MAPPER@@*/', () => read('src', 'mapper.js'))
  .replace('/*@@APP@@*/', () => read('src', 'app.js'));

fs.writeFileSync(p('index.html'),
  '<!doctype html>\n<html lang="pl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  html.replace('<div class="wrap">', '</head>\n<body>\n<div class="wrap">') + '</body>\n</html>\n');
if (process.env.FRAGMENT_OUT) fs.writeFileSync(process.env.FRAGMENT_OUT, html);
console.log('OK: index.html (' + Math.round(fs.statSync(p('index.html')).size / 1024) + ' KB)');
