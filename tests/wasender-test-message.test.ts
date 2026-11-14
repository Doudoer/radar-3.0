import { describe, expect, it } from 'vitest';
import { buildWasenderTestMessage } from '../src/integrations/wasender/testMessage';

describe('buildWasenderTestMessage', () => {
  it('uses the real operator name and configured session', () => {
    const message = buildWasenderTestMessage({
      timeLabel: '10:30:00',
      operatorName: 'María Pérez',
      sessionName: 'RADAR Ventas',
      connectedPhone: '+58 412-0000000',
    });

    expect(message).toContain('*Operador:* María Pérez');
    expect(message).toContain('*Sesión:* RADAR Ventas (+58 412-0000000)');
    expect(message).toContain('*Hora:* 10:30:00');
    expect(message).not.toContain('Douglas');
  });

  it('omits the session line when no session is configured', () => {
    const message = buildWasenderTestMessage({
      timeLabel: '10:30:00',
      operatorName: 'María Pérez',
      sessionName: '   ',
      connectedPhone: '+58 412-0000000',
    });

    expect(message).not.toContain('*Sesión:*');
    expect(message).not.toContain('+58 412-0000000');
  });

  it('falls back to Administrador when the operator name is empty', () => {
    const message = buildWasenderTestMessage({ timeLabel: '08:00:00', operatorName: '  ' });
    expect(message).toContain('*Operador:* Administrador');
  });
});
