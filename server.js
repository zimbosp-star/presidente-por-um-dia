/**
 * Servidor — "Presidente por um Dia"
 * ---------------------------------------------------
 * Este servidor expõe uma API simples de chave/valor (GET/PUT/DELETE/LIST)
 * que imita a API window.storage usada pelo jogo original (feito pra rodar
 * como artifact do Claude). O jogo faz polling nessa API pra sincronizar
 * salas, jogadores e votos entre os participantes — não usa WebSocket.
 *
 * Rotas:
 *   GET    /api/kv/:key              -> { key, value } ou 404
 *   PUT    /api/kv/:key  {value}     -> salva
 *   DELETE /api/kv/:key              -> remove
 *   GET    /api/kv?prefix=xxx        -> { keys: [...] }
 *
 * Armazenamento em memória (some se o servidor reiniciar — ok pra esse jogo,
 * já que as salas são efêmeras e expiram sozinhas).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// -------------------------------------------------------------
// Armazenamento em memória (chave -> valor string)
// -------------------------------------------------------------
const store = new Map();

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return true;
  }

  // GET /api/kv?prefix=xxx  -> lista chaves
  if (req.method === 'GET' && url.pathname === '/api/kv') {
    const prefix = url.searchParams.get('prefix') || '';
    const keys = Array.from(store.keys()).filter((k) => k.startsWith(prefix));
    sendJson(res, 200, { keys });
    return true;
  }

  const match = url.pathname.match(/^\/api\/kv\/(.+)$/);
  if (!match) return false;

  const key = decodeURIComponent(match[1]);

  if (req.method === 'GET') {
    if (!store.has(key)) { sendJson(res, 404, { error: 'not found' }); return true; }
    sendJson(res, 200, { key, value: store.get(key) });
    return true;
  }

  if (req.method === 'PUT') {
    const raw = await readBody(req);
    let value;
    try { value = JSON.parse(raw).value; } catch { value = raw; }
    store.set(key, value);
    sendJson(res, 200, { key, value });
    return true;
  }

  if (req.method === 'DELETE') {
    store.delete(key);
    sendJson(res, 200, { key, deleted: true });
    return true;
  }

  return false;
}

// -------------------------------------------------------------
// Limpeza periódica de salas antigas (chaves "room:XXXX:*" criadas
// há mais de 24h). O próprio jogo também tenta limpar do lado dele,
// isso aqui é só uma rede de segurança pro servidor não crescer sem fim.
// -------------------------------------------------------------
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of store.entries()) {
    if (!key.endsWith(':meta')) continue;
    try {
      const meta = JSON.parse(value);
      if (meta.createdAt && now - meta.createdAt > ROOM_TTL_MS) {
        const code = key.split(':')[1];
        for (const k of Array.from(store.keys())) {
          if (k.startsWith(`room:${code}:`)) store.delete(k);
        }
      }
    } catch { /* ignora entradas mal formadas */ }
  }
}, 60 * 60 * 1000); // roda a cada hora

// -------------------------------------------------------------
// Servidor HTTP: serve o jogo (index.html) + a API acima
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, url);
    if (handled) return;
    sendJson(res, 404, { error: 'rota não encontrada' });
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('index.html não encontrado — coloque-o na mesma pasta do server.js'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
