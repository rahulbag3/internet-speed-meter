import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

// Everything the harness needs is repo-relative except one file: the authoritative reference
// HTML, which lives outside this repository. Point at it with SM_REFERENCE_HTML, or with a
// gitignored tools/paths.local.json containing { "referenceHtml": "C:/.../speed-meter.html" }.

export const ROOT = path.resolve(import.meta.dirname, '..');
export const APP_EXE = path.join(ROOT, 'bin', 'Release', 'net8.0-windows', 'InternetSpeedMeter.exe');
export const APP_HTML = path.join(ROOT, 'Assets', 'speed-meter.html');
export const WINSHOT = path.join(ROOT, 'tools', 'winshot', 'bin', 'Release',
  'net8.0-windows', 'winshot.exe');

function localConfig() {
  const file = path.join(ROOT, 'tools', 'paths.local.json');
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}

export const REFERENCE_HTML = process.env.SM_REFERENCE_HTML || localConfig().referenceHtml || '';

export function requireReference() {
  if (!REFERENCE_HTML || !existsSync(REFERENCE_HTML)) {
    throw new Error(
      'Reference HTML not found. Set SM_REFERENCE_HTML or write tools/paths.local.json ' +
      'as { "referenceHtml": "<path to speed-meter.html>" }. See tools/paths.local.example.json.');
  }
  return REFERENCE_HTML.replace(/\\/g, '/');
}
