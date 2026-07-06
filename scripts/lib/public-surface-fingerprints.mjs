import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '__pycache__', '.pytest_cache']);
const BINARY_EXTENSIONS = new Set([
  '.avif',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.m4v',
  '.mov',
  '.mp4',
  '.pdf',
  '.png',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
]);

export const PUBLIC_SURFACE_FINGERPRINTS = [
  { label: 'private-marker-001', chars: 6, hash: '015993b5:0ec6852f' },
  { label: 'private-marker-002', chars: 3, hash: '185ec19e:5d4b84c4' },
  { label: 'private-marker-003', chars: 5, hash: '2314e0c0:d520ce1e' },
  { label: 'private-marker-004', chars: 5, hash: 'ac6bb54e:1fb5f86c' },
  { label: 'private-marker-005', chars: 3, hash: '18633f5a:5d549a56' },
  { label: 'private-marker-006', chars: 3, hash: '1862852c:5d6ae326' },
  { label: 'private-marker-007', chars: 3, hash: '1b4503c7:688a6a37' },
  { label: 'private-marker-008', chars: 2, hash: '002ccc88:00578fc4' },
  { label: 'private-path-001', chars: 14, hash: '4d70d1f4:461b4752' },
  { label: 'private-path-002', chars: 12, hash: 'f138bf59:d15839fd' },
  { label: 'private-path-003', chars: 12, hash: 'f8539aa3:092c8293' },
  { label: 'private-path-004', chars: 34, hash: '9705c886:011353f8' },
  { label: 'private-path-005', chars: 14, hash: 'c6c50c3d:4dc03189' },
];

export const PUBLIC_SURFACE_CREDENTIAL_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /ghp_[A-Za-z0-9_]{8,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
];

function toPosix(pathValue) {
  return pathValue.replace(/\\/g, '/');
}

const BASE1 = 131;
const BASE2 = 257;

function fingerprintKey(hash1, hash2) {
  return `${hash1.toString(16).padStart(8, '0')}:${hash2.toString(16).padStart(8, '0')}`;
}

function fingerprintCodes(codes) {
  let hash1 = 0;
  let hash2 = 0;
  for (const code of codes) {
    hash1 = (Math.imul(hash1, BASE1) + code) >>> 0;
    hash2 = (Math.imul(hash2, BASE2) + code) >>> 0;
  }
  return fingerprintKey(hash1, hash2);
}

export function publicSurfaceFingerprint(value) {
  return fingerprintCodes(Array.from(value, (char) => char.codePointAt(0)));
}

function power(base, exponent) {
  let result = 1;
  for (let index = 1; index < exponent; index += 1) {
    result = Math.imul(result, base) >>> 0;
  }
  return result;
}

function shouldScanFile(relPath, buffer) {
  if (BINARY_EXTENSIONS.has(extname(relPath).toLowerCase())) return false;
  return !buffer.includes(0);
}

function collectFiles(root) {
  const files = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  walk(root);
  return files.sort();
}

export function scanPublicSurfaceText({ relPath, text }) {
  const findings = [];
  const targetCodes = Array.from(`${relPath}\n${text}`, (char) => char.codePointAt(0));
  const rulesByLength = new Map();

  for (const rule of PUBLIC_SURFACE_FINGERPRINTS) {
    const group = rulesByLength.get(rule.chars) ?? new Map();
    group.set(rule.hash, rule);
    rulesByLength.set(rule.chars, group);
  }

  for (const [length, group] of rulesByLength) {
    if (targetCodes.length < length) continue;
    let hash1 = 0;
    let hash2 = 0;
    for (let index = 0; index < length; index += 1) {
      hash1 = (Math.imul(hash1, BASE1) + targetCodes[index]) >>> 0;
      hash2 = (Math.imul(hash2, BASE2) + targetCodes[index]) >>> 0;
    }

    const power1 = power(BASE1, length);
    const power2 = power(BASE2, length);

    for (let index = 0; index <= targetCodes.length - length; index += 1) {
      const rule = group.get(fingerprintKey(hash1, hash2));
      if (rule) {
        findings.push({
          code: 'PUBLIC_SURFACE_FORBIDDEN_FINGERPRINT',
          marker: rule.label,
        });
        break;
      }

      if (index < targetCodes.length - length) {
        hash1 = (Math.imul((hash1 - Math.imul(targetCodes[index], power1)) >>> 0, BASE1) + targetCodes[index + length]) >>> 0;
        hash2 = (Math.imul((hash2 - Math.imul(targetCodes[index], power2)) >>> 0, BASE2) + targetCodes[index + length]) >>> 0;
      }
    }
  }

  const target = `${relPath}\n${text}`;
  for (const pattern of PUBLIC_SURFACE_CREDENTIAL_PATTERNS) {
    if (pattern.test(target)) {
      findings.push({ code: 'PUBLIC_SURFACE_FORBIDDEN_CREDENTIAL', marker: pattern.source });
    }
  }

  return findings;
}

export function scanPublicSurfaceRoot(targetRoot) {
  const root = resolve(targetRoot);
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    return {
      ok: false,
      error: `not a directory: ${root}`,
      filesChecked: 0,
      findings: [],
    };
  }

  const findings = [];
  let filesChecked = 0;
  for (const file of collectFiles(root)) {
    const relPath = toPosix(relative(root, file));
    const buffer = readFileSync(file);
    if (!shouldScanFile(relPath, buffer)) continue;
    filesChecked += 1;
    for (const finding of scanPublicSurfaceText({ relPath, text: buffer.toString('utf8') })) {
      findings.push({ file: relPath, ...finding });
    }
  }

  return {
    ok: findings.length === 0,
    filesChecked,
    findings,
  };
}
