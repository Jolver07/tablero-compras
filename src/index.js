// Worker del tablero de compras.
// - Sirve los archivos de ./public (tablero y data.json).
// - /api/datos  GET: datos publicados (KV "DATOS").  PUT: publica datos nuevos con la clave ADMIN_KEY.
// - /api/fuente GET: Excel "Seguimiento de Solpeds" compartido con dashboard-compras y
//                reporte-proveedores (bucket R2 enlazado como FUENTE). Se publica solo desde
//                el Administrador de dashboard-compras; el tablero lo usa antes que /api/datos.
const H = { 'x-tablero-api': '1', 'cache-control': 'no-store' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/datos') return api(request, env);
    if (url.pathname === '/api/fuente') return fuente(request, env);
    return env.ASSETS.fetch(request);
  },
};

async function api(request, env) {
  if (request.method === 'GET') {
    if (!env.DATOS) return new Response('Sin almacenamiento KV configurado', { status: 404, headers: H });
    const datos = await env.DATOS.get('data.json', { type: 'stream' });
    if (!datos) return new Response('Sin datos publicados', { status: 404, headers: H });
    return new Response(datos, { headers: { ...H, 'content-type': 'application/json; charset=utf-8' } });
  }
  if (request.method === 'PUT') {
    if (!env.DATOS || !env.ADMIN_KEY) return new Response('El sitio no está configurado para publicar: falta el KV "DATOS" o el secreto ADMIN_KEY.', { status: 500, headers: H });
    const clave = request.headers.get('x-clave-admin') || '';
    if (!(await igual(clave, env.ADMIN_KEY))) return new Response('Clave incorrecta', { status: 401, headers: H });
    const texto = await request.text();
    if (texto.length > 24 * 1024 * 1024) return new Response('El archivo supera 24 MB; filtre el reporte a menos meses.', { status: 413, headers: H });
    let d;
    try { d = JSON.parse(texto); } catch { return new Response('Formato inválido', { status: 400, headers: H }); }
    if (!d || typeof d.n !== 'number' || !d.cols || !d.cols['Solped']) return new Response('Formato inválido: faltan columnas', { status: 400, headers: H });
    await env.DATOS.put('data.json', texto, { metadata: { fuente: String(d.fuente || ''), n: d.n, publicado: new Date().toISOString() } });
    return new Response(JSON.stringify({ ok: true, n: d.n }), { headers: { ...H, 'content-type': 'application/json' } });
  }
  return new Response('Método no permitido', { status: 405, headers: { ...H, allow: 'GET, PUT' } });
}

async function fuente(request, env) {
  const h = { ...H, 'x-fuente-comun': '1', 'content-type': 'application/json; charset=utf-8' };
  if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'El Excel se publica desde dashboard-compras.' }), { status: 405, headers: { ...h, allow: 'GET' } });
  if (!env.FUENTE) return new Response(JSON.stringify({ error: 'Falta enlazar el bucket R2 FUENTE.' }), { status: 500, headers: h });
  const obj = await env.FUENTE.get('fuente-comun.json');
  if (!obj) return new Response(JSON.stringify({ error: 'Todavía no se ha publicado el Excel compartido.' }), { status: 404, headers: h });
  return new Response(obj.body, { headers: { ...h, 'x-fuente-publicado': obj.customMetadata?.publicado || obj.uploaded.toISOString() } });
}

async function igual(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let r = 0; for (let i = 0; i < u.length; i++) r |= u[i] ^ v[i];
  return r === 0;
}
