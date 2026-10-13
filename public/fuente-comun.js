/* =====================================================================
   FUENTE COMÚN — un solo Excel "Seguimiento de Solpeds" para los 3 tableros
   (dashboard-compras, reporte-proveedores, tablero-compras).

   Este archivo es IDÉNTICO en los tres repositorios. Si lo cambias en uno,
   copia el mismo archivo a los otros dos.

   - codificar(XLSX, arrayBuffer, nombreArchivo): lee el Excel UNA vez y lo
     convierte en un JSON compacto por columnas (textos con diccionario,
     fechas en milisegundos). Lo usa solo la página que publica
     (Administrador de dashboard-compras).
   - aMatriz(F):  devuelve la hoja como [encabezados, fila1, fila2, …],
     igual que XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:''}).
   - aObjetos(F): devuelve [{encabezado: valor}, …], igual que
     XLSX.utils.sheet_to_json(ws, {raw:true, defval:null}).
   - cargar(): GET api/fuente. Devuelve el archivo compartido o null si
     todavía no se ha publicado (404).

   Las fechas vuelven como objetos Date exactamente iguales a los que entrega
   SheetJS con cellDates:true, así que cada tablero sigue usando su propio
   código de cálculo sin cambios.
   ===================================================================== */
(function (raiz) {
  'use strict';
  var VERSION = 1;
  var URL_API = 'api/fuente';

  function esFecha(v) { return v instanceof Date; }

  /** Busca la hoja del reporte: la llamada "Seguimiento de Solpeds" o, si no
   *  existe, la primera hoja que tenga las columnas "Solped" y "Proveedor"
   *  dentro de sus primeras 10 filas. */
  function elegirHoja(XLSX, wb) {
    var norm = function (s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
    var orden = wb.SheetNames.slice().sort(function (a, b) {
      return (norm(b) === 'seguimientodesolpeds') - (norm(a) === 'seguimientodesolpeds');
    });
    for (var s = 0; s < orden.length; s++) {
      var aoa = XLSX.utils.sheet_to_json(wb.Sheets[orden[s]], { header: 1, raw: true, defval: null, blankrows: false });
      for (var i = 0; i < Math.min(10, aoa.length); i++) {
        var h = (aoa[i] || []).map(norm);
        if (h.indexOf('solped') >= 0 && h.indexOf('proveedor') >= 0) return { hoja: orden[s], aoa: aoa, fila: i };
      }
    }
    throw new Error('No encontré una hoja con las columnas "Solped" y "Proveedor". Verifica que sea el reporte "Seguimiento de Solpeds".');
  }

  /** Lee el Excel y lo convierte al formato compartido. */
  function codificar(XLSX, arrayBuffer, nombreArchivo) {
    var wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, dense: true, cellStyles: false, cellHTML: false, cellFormula: false });
    var h = elegirHoja(XLSX, wb);
    var enc = h.aoa[h.fila].map(function (x) { return x == null ? '' : String(x); });
    var filas = h.aoa.slice(h.fila + 1).filter(function (r) {
      for (var j = 0; j < r.length; j++) if (r[j] != null && r[j] !== '') return true;
      return false;
    });
    var n = filas.length;
    var cols = enc.map(function (_, c) {
      var tipos = { s: 0, n: 0, d: 0, o: 0 };
      for (var i = 0; i < n; i++) {
        var v = filas[i][c];
        if (v == null) continue;
        if (esFecha(v)) tipos.d++; else if (typeof v === 'string') tipos.s++; else if (typeof v === 'number') tipos.n++; else tipos.o++;
      }
      var usados = Object.keys(tipos).filter(function (k) { return tipos[k] > 0; });
      var t = usados.length === 1 && usados[0] !== 'o' ? usados[0] : (usados.length === 0 ? 'n' : 'x');
      var v = new Array(n);
      if (t === 's') {
        var dict = [], idx = new Map();
        for (var i2 = 0; i2 < n; i2++) {
          var x = filas[i2][c];
          if (x == null) { v[i2] = null; continue; }
          var k = idx.get(x);
          if (k === undefined) { k = dict.length; dict.push(x); idx.set(x, k); }
          v[i2] = k;
        }
        return { t: 's', dict: dict, v: v };
      }
      for (var i3 = 0; i3 < n; i3++) {
        var y = filas[i3][c];
        if (y == null) v[i3] = null;
        else if (t === 'd') v[i3] = isNaN(y) ? null : y.getTime();
        else if (t === 'x') v[i3] = esFecha(y) ? { $d: isNaN(y) ? null : y.getTime() } : y;
        else v[i3] = y;
      }
      return { t: t, v: v };
    });
    return {
      formato: 'fuente-comun', version: VERSION,
      archivo: String(nombreArchivo || 'Seguimiento de Solpeds').slice(0, 200),
      hoja: h.hoja, n: n, encabezados: enc, cols: cols,
    };
  }

  function lector(col) {
    if (!col) return function () { return null; };
    if (col.t === 's') return function (i) { var k = col.v[i]; return k == null ? null : col.dict[k]; };
    if (col.t === 'd') return function (i) { var m = col.v[i]; return m == null ? null : new Date(m); };
    if (col.t === 'x') return function (i) { var x = col.v[i]; return x && typeof x === 'object' && '$d' in x ? (x.$d == null ? new Date(NaN) : new Date(x.$d)) : x; };
    return function (i) { var x = col.v[i]; return x == null ? null : x; };
  }

  function validar(F) {
    if (!F || F.formato !== 'fuente-comun' || !Array.isArray(F.encabezados) || !Array.isArray(F.cols) || typeof F.n !== 'number')
      throw new Error('El archivo compartido no tiene el formato esperado.');
  }

  /** [encabezados, ...filas]; celdas vacías como '' (o el valor que pases). */
  function aMatriz(F, vacio) {
    validar(F);
    if (vacio === undefined) vacio = '';
    var L = F.cols.map(lector), m = F.encabezados.length;
    var out = new Array(F.n + 1);
    out[0] = F.encabezados.slice();
    for (var i = 0; i < F.n; i++) {
      var r = new Array(m);
      for (var c = 0; c < m; c++) { var v = L[c](i); r[c] = v == null ? vacio : v; }
      out[i + 1] = r;
    }
    return out;
  }

  /** [{encabezado: valor}]; celdas vacías como null. Encabezados repetidos
   *  reciben _1, _2… igual que SheetJS. */
  function aObjetos(F) {
    validar(F);
    var L = F.cols.map(lector), vistos = {};
    var claves = F.encabezados.map(function (h) {
      var k = h, j = 0;
      while (Object.prototype.hasOwnProperty.call(vistos, k)) k = h + '_' + (++j);
      vistos[k] = 1;
      return k;
    });
    var out = new Array(F.n);
    for (var i = 0; i < F.n; i++) {
      var o = {};
      for (var c = 0; c < claves.length; c++) { var v = L[c](i); o[claves[c]] = v == null ? null : v; }
      out[i] = o;
    }
    return out;
  }

  /** Descarga el archivo compartido. null = todavía no se publica ninguno
   *  (o el sitio aún no tiene la ruta /api/fuente). */
  async function cargar() {
    var r = await fetch(URL_API, { cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('No se pudo obtener el archivo compartido (HTTP ' + r.status + ').');
    if (r.headers.get('x-fuente-comun') !== '1') return null; // la ruta no existe todavía (respondió la página)
    var F = await r.json();
    validar(F);
    F.publicado = r.headers.get('x-fuente-publicado') || null; // fecha ISO de publicación
    return F;
  }

  var api = { VERSION: VERSION, codificar: codificar, aMatriz: aMatriz, aObjetos: aObjetos, cargar: cargar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.FuenteComun = api;
})(typeof self !== 'undefined' ? self : this);
