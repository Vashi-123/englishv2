import fs from 'node:fs';
import { webcrypto } from 'node:crypto';

function argValue(argv, name) {
  const idx = argv.indexOf(name);
  if (idx === -1) return null;
  const v = argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return v;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function usage() {
  console.log(`
Generate Apple "client secret" (JWT) for Sign in with Apple (web).

Usage:
  node scripts/apple-client-secret.mjs \\
    --team-id <TEAM_ID> \\
    --key-id <KEY_ID> \\
    --client-id <SERVICE_ID> \\
    --p8 <path/to/AuthKey_XXXXXX.p8> \\
    [--days 180]

Notes:
  - client-id must be your Service ID identifier (e.g. com.gopractice.web)
  - Do NOT commit the .p8 file to git.
`);
}

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function pemToDer(pem) {
  const stripped = String(pem || '')
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  return Buffer.from(stripped, 'base64');
}

async function importPkcs8P256PrivateKey(p8Pem) {
  const der = pemToDer(p8Pem);
  return await webcrypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    usage();
    process.exit(argv.length ? 0 : 1);
  }

  const teamId = argValue(argv, '--team-id');
  const keyId = argValue(argv, '--key-id');
  const clientId = argValue(argv, '--client-id');
  const p8Path = argValue(argv, '--p8');
  const days = Number(argValue(argv, '--days') || '180');

  if (!teamId || !keyId || !clientId || !p8Path) {
    console.error('Missing required args.');
    usage();
    process.exit(1);
  }

  const p8Pem = fs.readFileSync(p8Path, 'utf8');
  const privateKey = await importPkcs8P256PrivateKey(p8Pem);

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + Math.max(1, Math.min(180, Number.isFinite(days) ? days : 180)) * 24 * 60 * 60;

  const header = { alg: 'ES256', kid: keyId };
  const payload = {
    iss: teamId,
    iat,
    exp,
    aud: 'https://appleid.apple.com',
    sub: clientId,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signingBytes = new TextEncoder().encode(signingInput);

  // WebCrypto returns a raw (r|s) 64-byte signature for P-256, which is exactly what JWS expects.
  const sig = new Uint8Array(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, signingBytes));
  const jwt = `${signingInput}.${base64url(Buffer.from(sig))}`;

  console.log(jwt);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

