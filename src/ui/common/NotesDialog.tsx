import { useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { useLab } from '../../state/store';

// Long-form text, styled as a block rather than element by element.
const PROSE =
  '[&_a]:text-[#9e9eff] [&_a]:underline [&_h3]:my-4 [&_h3]:text-16 [&_h3]:font-bold [&_h3]:text-accent [&_li]:text-14 [&_li]:text-[#bfcbd9] [&_p]:my-3.5 [&_p]:text-14 [&_p]:text-[#bfcbd9] [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-10';

export function NotesDialog() {
  const open = useLab((s) => s.notesOpen);
  const setOpen = useLab((s) => s.setNotesOpen);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // Clicks on the backdrop land on the dialog itself, outside its box.
  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== dialog.current) return;
    const box = dialog.current.getBoundingClientRect();
    const { clientX: x, clientY: y } = event;
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) setOpen(false);
  }

  return (
    <dialog
      className={`m-auto max-h-[85dvh] w-[min(680px,calc(100vw-32px))] rounded-2xl border border-[#435367] bg-[#171f2c] p-7 leading-[1.7] text-ink shadow-[0_30px_100px_#0008] backdrop:bg-[#0009] backdrop:backdrop-blur-[4px] ${PROSE}`}
      ref={dialog}
      onClick={closeOnBackdrop}
      onClose={() => setOpen(false)}
    >
      <div className="flex justify-between gap-3">
        <h2 className="mb-4.5 text-22 font-semibold">El modelo detrás del movimiento</h2>
        <button className="self-start" aria-label="Cerrar" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>
      <p>
        Cada panel tiene dos giros en serie. El centro del hexágono y su orientación se calculan con
        cinemática directa, conservando el orden <b>Rₓ(q₁) Rᵧ(q₂)</b>.
      </p>
      <div className="overflow-auto rounded-lg border border-[#324456] bg-[#0e1723] p-4 font-mono text-14">
        u = R₀₁ᵀ (p − r₀₂) / ‖p − r₀₂‖
        <br />
        q₂ = asin(uₓ) &nbsp; · &nbsp; q₁ = atan2(−uᵧ, u𝓏)
        <br />
        r₀₃ = r₀₂ + R₀₁ Rₓ(q₁) Rᵧ(q₂) [0, 0, z₂₃]ᵀ
      </div>
      <p>
        El eje central apunta al objetivo; el centro del panel no se traslada libremente hasta la
        esfera. Los filtros procesan los ángulos y la cinemática directa reconstruye la pose. El
        retraso respecto al objetivo aparece como error angular.
      </p>
      <h3>Correcciones incorporadas</h3>
      <ul>
        <li>Conversión al sistema local de cada montaje.</li>
        <li>
          Conservación de q₁ cuando la dirección es singular. Si el objetivo coincide con el pivote,
          se mantiene la pose y el error se muestra como indefinido.
        </li>
        <li>Selección de solución válida cercana a la pose anterior y saturación después del filtro.</li>
        <li>Trayectorias periódicas continuas (excepto el escalón intencional).</li>
        <li>Perfil trapezoidal con t total = 2 t aceleración + t crucero.</li>
        <li>
          Valores iniciales de los filtros equivalentes en tiempo a los de la sesión de filtros, que
          usa un paso de 32 ms: τ = 0.62 s (α = 0.05), media móvil N = 58 (N = 15), mediana N = 35
          (N = 9) y velocidad máxima de 300 °/s (ω máx / 2).
        </li>
        <li>Paso de cálculo fijo de 1/120 s, independiente de los cuadros por segundo.</li>
      </ul>
      <h3>Geometría y alcance</h3>
      <p>
        Representación esquemática, no importación CAD. El hexágono mide 120 mm entre vértices (103.92
        mm entre caras) y 5 mm de espesor, según module.step y el plano Sofia003-E001-04_2. Separación
        inicial de bases: 150 mm, ajustable entre 120 y 500 mm.
        Las longitudes z₁₂ = 22 mm y z₂₃ = 37 mm son las alturas de la ficha técnica y son editables. El rango inicial de ±30° es ajustable hasta ±90° y no es una calibración del servo.
      </p>
      <p>
        Se limitan ángulos; no se simulan torque, consumo ni dinámica real del MG90S. Las colisiones
        entre placas se detectan y se marcan en la escena, pero no detienen el movimiento; ejes,
        servos y cables no se comprueban.
        «Sin filtro» es una referencia ideal. Los perfiles trapezoidal y en S capturan un objetivo
        por segmento; el resto de filtros recibe el objetivo en cada paso.
      </p>
      <h3>Separación conservadora</h3>
      <p>
        La recomendación usa d ≥ 2√((z₂₃ + 4.3)² + 60²) + 2 mm, redondeada hacia arriba.
        Cada placa queda dentro de una esfera alrededor de su pivote; separar estas envolventes evita
        cruces entre placas para cualquier ángulo del modelo. Los 2 mm son la holgura mínima del
        requisito R5. Con z₂₃ = 37 mm, la recomendación es 148 mm. No
        certifica holguras de servos, cables ni soportes. Si cambias z₂₃, revisa y vuelve a aplicar
        la recomendación.
      </p>
      <h3>Cámara y gestos</h3>
      <p>
        La detección usa MediaPipe en tu navegador. La cámara solo se solicita al pulsar Activar
        cámara; no se usa audio, no se suben imágenes y se apaga al abandonar la página o cambiar a
        Automático/Cursor. Los modelos y el código de detección vienen incluidos en esta aplicación,
        así que no necesitas internet para usarlos.
      </p>
      <p>
        Gestos: los seis de <code>sofia-tracker</code>, con las mismas reglas, umbrales y
        suavizado (son una copia de su <code>gestures.py</code>). Índice → mirar arriba y luego
        abajo; V → dibujar un 8 horizontal; palma abierta → mirar a la derecha y luego a la
        izquierda; barrido a la izquierda o a la derecha → ola que cruza el panal en esa dirección;
        agarre (de palma a puño) → sobresalto y regreso al reposo. Índice, V y palma se disparan al
        sostener la postura con la mano quieta 0.5 s; el barrido, al deslizar la mano rápido hacia
        un lado; el agarre, al pasar de la palma abierta al puño en menos de medio segundo. La
        imagen se muestra en espejo, como en <code>sofia-tracker</code>. Con el panel real
        conectado y el control en este navegador, los gestos y la mano también se envían al
        Maestro. Cada gesto reproduce una vez el mismo movimiento que
        el Maestro (una copia de su coreografía), en el que cada unidad tiene su propio objetivo,
        registrado en el CSV; un gesto reconocido mientras otro se reproduce se ignora. Entre
        gestos, el centro de la palma se mapea como en el Maestro: los bordes de la imagen quedan a
        ±230 mm del centro del panal, a la profundidad elegida. Todas las trayectorias atraviesan la
        misma cinemática, restricciones y filtros. La señal de cámara se estabiliza con τ = 0.12 s
        antes de los filtros articulares. Perder la mano durante 0.5 s retiene la pose y detiene
        los filtros, como el Maestro. Es seguimiento visual 2D, no medición métrica de profundidad
        ni calibración extrínseca de cámara.
      </p>
      <p>
        La cámara física no se ha probado en tu equipo. La iluminación, el encuadre, los permisos y
        el rendimiento pueden afectar la detección. Las entradas, los gestos, las ecuaciones, los
        filtros y la representación siguen separados para futuras ampliaciones.
      </p>
      <p>
        Referencia de implementación:{' '}
        <a
          href="https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js"
          target="_blank"
          rel="noopener noreferrer"
        >
          MediaPipe Hand Landmarker
        </a>
        .
      </p>
      <h3>Fuentes</h3>
      <p>
        Material proporcionado: Modelado cinemático, pp. 9–13; Aplicación de Filtros; Arquitectura y
        Desarrollo SOFIA; planos Sofia003-E001-04 y código SOFIA_Asignación1. La exportación contiene
        datos simulados, hasta los últimos 5 minutos a 10 Hz.
      </p>
    </dialog>
  );
}
