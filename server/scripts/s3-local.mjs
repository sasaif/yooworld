// Minimal LOCAL S3-compatible object store (R2/S3 emulation for backup tests). 127.0.0.1 only.
// Verifies AWS SigV4 on every request (same signer family as R2's S3 API) and the payload SHA-256.
// Supports PUT / GET / HEAD / DELETE object and ListObjectsV2 (prefix). Objects live in a local directory.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AwsV4Signer } from 'aws4fetch';

export async function startS3Local({ dir, port = 0, accessKeyId, secretAccessKey, region = 'auto' }) {
  fs.mkdirSync(dir, { recursive: true });
  const stats = { put: 0, get: 0, denied: 0, bytesIn: 0, bytesOut: 0 };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const auth = String(req.headers.authorization ?? '');
    const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(auth);
    const deny = (code, why) => { stats.denied++; res.writeHead(code, { 'content-type': 'application/xml' }); res.end(`<Error><Code>${why}</Code></Error>`); };
    if (!m || m[1] !== accessKeyId) return deny(403, 'InvalidAccessKeyId');
    const signed = m[4].split(';');
    const headers = {}; for (const h of signed) if (h !== 'host') headers[h] = String(req.headers[h] ?? '');
    const sha = String(req.headers['x-amz-content-sha256'] ?? '');
    if (sha !== crypto.createHash('sha256').update(body).digest('hex') && !(sha === 'UNSIGNED-PAYLOAD' && body.length === 0)) return deny(400, 'XAmzContentSHA256Mismatch');
    const v = new AwsV4Signer({ method: req.method, url: url.toString(), headers, accessKeyId, secretAccessKey, service: 's3', region, datetime: String(req.headers['x-amz-date']) });
    const expected = await v.authHeader();
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(auth.padEnd(expected.length).slice(0, Math.max(expected.length, auth.length)))) || expected.length !== auth.length) return deny(403, 'SignatureDoesNotMatch');
    const [, bucket, ...rest] = url.pathname.split('/'); const key = decodeURIComponent(rest.join('/'));
    if (!/^[a-z0-9-]{3,63}$/.test(bucket ?? '')) return deny(400, 'InvalidBucketName');
    const file = path.join(dir, bucket, key);
    if (!file.startsWith(path.join(dir, bucket) + path.sep) && key) return deny(400, 'InvalidKey');
    if (req.method === 'PUT') { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); stats.put++; stats.bytesIn += body.length;
      res.writeHead(200, { etag: `"${crypto.createHash('md5').update(body).digest('hex')}"` }); return res.end(); }
    if ((req.method === 'GET' || req.method === 'HEAD') && key) {
      if (!fs.existsSync(file)) return deny(404, 'NoSuchKey');
      const data = fs.readFileSync(file); stats.get++; stats.bytesOut += data.length;
      res.writeHead(200, { 'content-length': data.length }); return res.end(req.method === 'HEAD' ? undefined : data);
    }
    if (req.method === 'DELETE' && key) { fs.rmSync(file, { force: true }); res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? ''; const root = path.join(dir, bucket); const keys = [];
      const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else keys.push(path.relative(root, p)); } };
      walk(root);
      const xml = keys.filter((k) => k.startsWith(prefix)).sort().map((k) => `<Contents><Key>${k}</Key><Size>${fs.statSync(path.join(root, k)).size}</Size></Contents>`).join('');
      res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(`<ListBucketResult>${xml}</ListBucketResult>`);
    }
    return deny(400, 'NotImplemented');
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { endpoint: `http://127.0.0.1:${server.address().port}`, stats, close: () => new Promise((r) => server.close(r)) };
}
