/**
 * DESCO's server sends only its own certificate and leaves out the
 * intermediate one, so a strict client cannot build the chain. Browsers fix this
 * by following the "CA Issuers" link inside the certificate; Node does not.
 *
 * This does the same at start-up: fetch the missing intermediate certificate(s)
 * and add them to the trusted store. Safe by design: an intermediate is only
 * ever trusted when it chains to a root already in the normal trust store, so a
 * forged download is simply rejected by the final verification.
 */
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';

let status = 'unchecked';
export const descoTlsStatus = () => status;

function probe(host, port, strict) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: strict, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate(false);
      const raw = cert?.raw;
      const error = socket.authorizationError || null;
      socket.end();
      resolve({ ok: true, raw, error });
    });
    socket.on('error', (error) => resolve({ ok: false, error: error.code || error.message }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, error: 'TIMEOUT' });
    });
  });
}

function issuerUrl(der) {
  const info = new X509Certificate(der).infoAccess || '';
  const match = /CA Issuers - URI:(https?:\/\/\S+)/.exec(info);
  return match ? match[1] : null;
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20_000) throw new Error('certificate too large');
  return new X509Certificate(bytes); // accepts DER or PEM
}

export async function ensureChain(host = 'prepaid.desco.org.bd', port = 443) {
  try {
    const first = await probe(host, port, true);
    if (first.ok) return (status = 'verified');
    if (!['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(first.error)) {
      return (status = `failed:${first.error}`);
    }
    if (typeof tls.setDefaultCACertificates !== 'function') return (status = 'failed:NODE_TOO_OLD');

    const loose = await probe(host, port, false);
    if (!loose.raw) return (status = `failed:${loose.error || 'NO_CERT'}`);

    const extra = [];
    let url = issuerUrl(loose.raw);
    for (let hop = 0; url && hop < 3; hop += 1) {
      const cert = await download(url);
      extra.push(cert.toString());
      url = cert.checkIssued(cert) ? null : issuerUrl(cert.raw); // stop at a self-signed root
    }
    if (!extra.length) return (status = 'failed:NO_ISSUER_LINK');

    tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...extra]);
    const second = await probe(host, port, true);
    return (status = second.ok ? 'verified' : `failed:${second.error}`);
  } catch (error) {
    return (status = `failed:${error.message}`);
  }
}
