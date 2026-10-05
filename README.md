# Tablero de cumplimiento de compras – NATURISA

Tablero web (HTML + JavaScript) publicado en Cloudflare Workers desde GitHub, con:

- Cumplimiento: OC cerradas con ingreso total ÷ OC aprobadas vigentes.
- OC abiertas vencidas y por vencer (días vencidos o por vencer; umbral configurable, 3 días por defecto).
- Ciclo de OC cerradas: SOLPED → último ingreso a bodega.
- Etapas del ciclo: aprob. cantidad, cotización, aprob. precio, aprobador OC1, aprobador OC2, generación OC, ingreso bodega.
- Ciclos en curso (no cerrados).
- Resumen por sucursal, tipo de solicitud, clúster y categoría.
- Filtros dinámicos: sucursal, tipo de solicitud, clúster, categoría (material/servicio/activo) y rango de fechas de SOLPED.
- Filtro por **número de SOLPED** (uno o varios, completos o parciales: `SP202604-00941, 00942`).
- **Datos en línea**: cualquiera que abra el enlace ve los datos publicados, sin cargar nada.
- El administrador actualiza los datos desde el mismo tablero: **Cargar reporte nuevo → Publicar para todos** (con clave).

## Estructura

```
tablero-compras/            ← ESTOS archivos van en la RAÍZ del repositorio
├── wrangler.jsonc           ← configuración de Cloudflare Workers
├── package.json
├── src/
│   └── index.js             ← sirve el tablero y la API /api/datos (Cloudflare KV)
├── public/                  ← archivos que ve el usuario
│   ├── index.html           ← el tablero
│   ├── data.json            ← datos precargados (se genera con el script)
│   ├── _headers             ← cabeceras de seguridad y caché
│   └── robots.txt
├── scripts/
│   └── generar_datos.py     ← convierte el Excel de SAP en public/data.json
├── requirements.txt
└── .gitignore               ← impide subir los .xlsx originales
```

## 1. Subir a GitHub

1. Cree un repositorio **privado** en GitHub (por ejemplo `tablero-compras`).
2. Suba el **contenido** de la carpeta `tablero-compras` (no la carpeta en sí): en la raíz del repositorio deben quedar `wrangler.jsonc`, `package.json`, `src/`, `public/`, `scripts/`.
   Desde la web de GitHub: *Add file → Upload files* y arrastre esos archivos y carpetas. O con git:

   ```bash
   cd tablero-compras
   git init
   git add .
   git commit -m "Tablero de cumplimiento de compras"
   git branch -M main
   git remote add origin https://github.com/<usuario-u-organizacion>/tablero-compras.git
   git push -u origin main
   ```

   Si el repositorio ya quedó con una subcarpeta `tablero-compras/`, en Cloudflare indique **Root directory / Path:** `tablero-compras`.

## 2. Publicar en Cloudflare (Workers)

1. **Workers & Pages → Create → Import a repository** (GitHub) y elija `tablero-compras`.
2. Configuración:
   - **Build command:** (vacío)
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory / Path:** `/` (o `tablero-compras` si quedó en subcarpeta)
3. **Deploy**. Queda en `https://tablero-compras.<su-subdominio>.workers.dev`.

Cada *push* a `main` vuelve a publicar automáticamente. Con solo esto el tablero ya muestra los datos de `public/data.json` a cualquiera que abra el enlace.

### 2.1 Activar “Publicar para todos” desde el tablero (una sola vez)

1. **Storage & Databases → KV → Create** → nombre `tablero-compras-datos`. Copie su **ID**.
2. En GitHub, edite `wrangler.jsonc`: quite las `//` de las tres líneas de `kv_namespaces` y pegue el ID en lugar de `PEGUE_AQUI_EL_ID_DEL_KV`. Guarde (commit): Cloudflare vuelve a desplegar.
3. En el Worker: **Settings → Variables and Secrets → Add** → tipo **Secret**, nombre `ADMIN_KEY`, valor: una clave larga que solo conozca el administrador.

Comprobación: `https://…workers.dev/api/datos` debe responder “Sin datos publicados” antes de la primera publicación.

## 3. Restringir el acceso (muy recomendado)

`data.json` contiene proveedores y OC de la empresa (no incluye precios ni valores). Un sitio en `workers.dev` es **público** por defecto.
Protéjalo con **Cloudflare Access** (Zero Trust, gratuito hasta 50 usuarios):

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Dominio de la aplicación: `tablero-compras.<su-subdominio>.workers.dev` (y su dominio propio si lo agrega). También puede activarlo desde el Worker: **Settings → Domains & Routes → workers.dev → Enable Cloudflare Access**.
3. Política **Allow** → *Emails ending in* `@naturisa.com.ec` (o la lista de correos autorizados).
4. Método de ingreso: *One-time PIN* por correo (no requiere configurar nada más).

Con Access activo, quien tenga el enlace ingresa su correo, recibe un código y ve el tablero con los datos ya cargados.

## 4. Actualizar los datos

### Opción A – desde el tablero (recomendada, sin GitHub ni Python)

1. Abra el tablero y presione **Cargar reporte nuevo**; elija el Excel “Seguimiento de Solpeds” (tarda 20–40 s con 25 MB).
2. Revise los datos. Aparece la barra **“Publicar para todos”**: escriba la clave `ADMIN_KEY` y presione el botón.
3. Desde ese momento todos los que abran el enlace ven el reporte nuevo (la propagación puede tardar hasta 1 minuto).

Los visitantes nunca necesitan cargar nada: el tablero lee primero los datos publicados (`/api/datos`) y, si no hay, usa `public/data.json`.
Si alguien sin clave usa **Cargar reporte nuevo**, el cambio solo se ve en su navegador.

### Opción B – por GitHub

Con Python 3.10 o superior:

```bash
pip install -r requirements.txt
python scripts/generar_datos.py "C:\Descargas\Seguimiento de Solpeds - 2026-10-05.xlsx"
git add public/data.json
git commit -m "Datos al 05/10/2026"
git push
```

- La fecha de corte se toma de la fecha más reciente del reporte; para fijarla: `--corte 2026-10-05`.
- Cloudflare admite archivos de hasta 25 MB; con ~83.000 líneas `data.json` pesa ~10 MB.
- El Excel original no se sube (lo bloquea `.gitignore`).

Si usa la opción A, los datos publicados desde el tablero tienen prioridad sobre `public/data.json`.

## Columnas requeridas del reporte

`Estado, Solped, Clúster, Sucursal, Tipo Solicitud, Categoría, Comprador(a), Proveedor, Código, Nombre de Item,
Fecha solped., Fecha Aprob, Fecha atención comprador, Fecha Preorden, Fecha Aprob Precio, Fecha Aprob 1 OC,
Fecha Aprob 2 OC, Fecha OC, OC ERP, Fecha de entrega, Ult. Fecha Ingr. Bod, Cant. Orden Compra, Cant. Ingreso,
Cantidad Pendiente`

## Definiciones principales

| Indicador | Cálculo |
|---|---|
| Cumplimiento | OC con todas sus posiciones no anuladas en “OC CERRADA (IT)” ÷ OC aprobadas (sin anuladas) |
| Vencida / por vencer | Fecha de entrega comprometida vs. fecha de corte; por vencer = vence en ≤ N días |
| Atención | Aprobación de la SOLPED → generación de la OC (no incluye ingreso a bodega) |
| Ciclo total | Fecha de SOLPED → último ingreso a bodega, solo OC cerradas con ingreso total |
| Etapas del ciclo | Diferencias entre fechas y horas de cada hito, por posición de OC cerrada con ingreso total |
| % atención | Líneas de SOLPED aprobadas con OC no anulada o contrato ÷ líneas aprobadas |

Días calendario. Librerías externas cargadas desde CDN: SheetJS (lectura de Excel, cdnjs) y fuentes IBM Plex (Google Fonts).
