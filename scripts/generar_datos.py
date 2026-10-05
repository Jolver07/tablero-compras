"""
Convierte el reporte "Seguimiento de Solpeds" (Excel exportado del portal de compras / SAP)
en public/data.json, el archivo que carga el tablero al abrirse.

Uso:
    python scripts/generar_datos.py "ruta/Seguimiento de Solpeds.xlsx"
    python scripts/generar_datos.py reporte.xlsx --salida public/data.json --corte 2026-10-05

Si no se indica --corte, se usa la fecha más reciente que aparece en el reporte
(fecha de SOLPED, de OC o de ingreso), que normalmente es el día de la extracción.
"""
import argparse, json, os, sys
from datetime import datetime
import pandas as pd

COLS = {
    'Estado': 's', 'Solped': 's', 'Clúster': 's', 'Sucursal': 's', 'Tipo Solicitud': 's', 'Categoría': 's',
    'Comprador(a)': 's', 'Proveedor': 's', 'Código': 's', 'Nombre de Item': 's',
    'Fecha solped.': 'ts', 'Fecha Aprob': 'ts', 'Fecha atención comprador': 'd', 'Fecha Preorden': 'ts',
    'Fecha Aprob Precio': 'ts', 'Fecha Aprob 1 OC': 'ts', 'Fecha Aprob 2 OC': 'ts', 'Fecha OC': 'ts', 'OC ERP': 'n',
    'Fecha de entrega': 'd', 'Ult. Fecha Ingr. Bod': 'ts', 'Cant. Orden Compra': 'n', 'Cant. Ingreso': 'n',
    'Cantidad Pendiente': 'n',
}
EPOCH = pd.Timestamp('1970-01-01')
BASE_MIN = int((pd.Timestamp('2025-01-01') - EPOCH).total_seconds() // 60)  # minutos; divisible para 10


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('reporte', help='Archivo Excel "Seguimiento de Solpeds"')
    ap.add_argument('--salida', default=os.path.join(os.path.dirname(__file__), '..', 'public', 'data.json'))
    ap.add_argument('--corte', help='Fecha de corte AAAA-MM-DD (opcional)')
    a = ap.parse_args()

    print(f'Leyendo {a.reporte} …')
    df = pd.read_excel(a.reporte)
    df.columns = [str(c).strip() for c in df.columns]
    faltan = [c for c in COLS if c not in df.columns]
    if faltan:
        sys.exit('ERROR: al reporte le faltan columnas: ' + ', '.join(faltan))
    df = df[df['Solped'].notna()].copy()          # quita la fila de totales

    out = {'n': int(len(df)), 'cols': {}}
    fechas_max = []
    for c, t in COLS.items():
        s = df[c]
        if t == 's':
            s = s.astype('string').fillna('')
            cat = pd.Categorical(s)
            out['cols'][c] = {'t': 's', 'dict': list(cat.categories), 'v': cat.codes.tolist()}
        elif t in ('d', 'ts'):
            s = pd.to_datetime(s, errors='coerce', dayfirst=True)
            if c in ('Fecha solped.', 'Fecha OC', 'Ult. Fecha Ingr. Bod') and s.notna().any():
                fechas_max.append(s.max())
            if t == 'd':
                v = (s.dt.normalize() - EPOCH).dt.days
                out['cols'][c] = {'t': 'd', 'v': [None if pd.isna(x) else int(x) for x in v]}
            else:
                m = (s - EPOCH).dt.total_seconds() // 600   # unidades de 10 minutos
                out['cols'][c] = {'t': 'ts', 'base': BASE_MIN, 'u': 10,
                                  'v': [None if pd.isna(x) else int(x) - BASE_MIN // 10 for x in m]}
        else:
            s = pd.to_numeric(s, errors='coerce')
            out['cols'][c] = {'t': 'n', 'v': [None if pd.isna(x) else (int(x) if float(x).is_integer() else round(float(x), 4)) for x in s]}

    corte = pd.Timestamp(a.corte) if a.corte else (max(fechas_max).normalize() if fechas_max else pd.Timestamp.today().normalize())
    out['corte'] = int((corte - EPOCH).days)
    nombre = os.path.basename(a.reporte)
    out['fuente'] = f'{nombre} – corte {corte:%d/%m/%Y} – generado {datetime.now():%d/%m/%Y %H:%M}'

    os.makedirs(os.path.dirname(os.path.abspath(a.salida)), exist_ok=True)
    with open(a.salida, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    mb = os.path.getsize(a.salida) / 1e6
    print(f'Listo: {a.salida} ({mb:.1f} MB, {len(df):,} líneas, corte {corte:%d/%m/%Y})')
    if mb > 24:
        print('AVISO: Cloudflare Pages acepta archivos de hasta 25 MB. Filtre el reporte a menos meses.')


if __name__ == '__main__':
    main()
