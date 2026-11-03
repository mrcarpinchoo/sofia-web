import { Hint } from '../common/Hint';
import { Section } from '../common/Section';

export function ConnectionPanel() {
  return (
    <Section number="00" title="Panel real · Wi‑Fi">
      <Hint>Enlace pendiente. Esta versión solo simula: ningún control mueve los servos.</Hint>
      <Hint size="small">
        El panel físico se conectará por Wi‑Fi al Maestro ESP32, en la red{' '}
        <code>SOFIA-Maestro</code> (<code>192.168.4.1:4210</code>).
      </Hint>
    </Section>
  );
}
