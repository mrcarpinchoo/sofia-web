const HEADER = [
  'tiempo_s',
  'unidad',
  'objetivo_x_mm',
  'objetivo_y_mm',
  'objetivo_z_mm',
  'q1_solicitado_deg',
  'q2_solicitado_deg',
  'q1_limitado_deg',
  'q2_limitado_deg',
  'q1_filtrado_deg',
  'q2_filtrado_deg',
  'error_deg',
  'fuera_alcance',
  'singular',
  'modo',
  'trayectoria',
  'filtro',
  'velocidad_trayectoria',
  'z12_mm',
  'z23_mm',
  'limite_deg',
  'politica',
  'parametros_filtro',
  'separacion_mm',
  'gesto',
  'pose_retenida_por_camara',
];

// Lets Excel recognize the file as UTF-8.
const BOM = '\ufeff';

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

export function toCsv(rows: string[][][]): Blob {
  const body = rows.flat().map((row) => row.map(quote).join(','));
  return new Blob([BOM, `${HEADER.join(',')}\n${body.join('\n')}`], {
    type: 'text/csv;charset=utf-8',
  });
}

export function download(blob: Blob, name: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 3000);
}
