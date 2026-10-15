import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RegisterFollowupCallModal } from '../src/components/RegisterFollowupCallModal';

describe('RegisterFollowupCallModal Component', () => {
  it('does not render when isOpen is false', () => {
    const html = renderToStaticMarkup(
      <RegisterFollowupCallModal
        isOpen={false}
        onClose={vi.fn()}
        orderId="577"
        orderCode="ORD-854857"
        customerName="Senor Miguel"
        customerPhone="9197576858"
      />
    );
    expect(html).toBe('');
  });

  it('renders modal dialog with order info, customer info, call result, and warranty alert when open', () => {
    const html = renderToStaticMarkup(
      <RegisterFollowupCallModal
        isOpen={true}
        onClose={vi.fn()}
        orderId="577"
        orderCode="ORD-854857"
        customerName="Senor Miguel"
        customerPhone="9197576858"
        vehicle="2009 TOYOTA Corolla"
        mainPart="Transmisión"
        daysSinceDelivery={5}
        assignedAdvisor="Favio Andrade"
        initialPartStatus="not_installed"
      />
    );

    expect(html).toContain('Registrar Seguimiento Post-Entrega');
    expect(html).toContain('ORD-854857');
    expect(html).toContain('Senor Miguel');
    expect(html).toContain('2009 TOYOTA Corolla');
    expect(html).toContain('Transmisión');
    expect(html).toContain('Día 5 de 14');
    expect(html).toContain('Favio Andrade');
    expect(html).toContain('Resultado de la Llamada Telefónica');
    expect(html).toContain('Estado Físico / Montaje de la Pieza');
    expect(html).toContain('Advertencia Verbal de Garantía Obligatoria');
    expect(html).toContain('¿Para qué fecha prometió instalar?');
    expect(html).toContain('Resumen de la Conversación (Bitácora)');
    expect(html).toContain('Guardar Registro');
    expect(html).toContain('Cancelar');
  });

  it('hides piece status and warranty warning when call was not answered (no_answer), but requires written explanation', () => {
    const html = renderToStaticMarkup(
      <RegisterFollowupCallModal
        isOpen={true}
        onClose={vi.fn()}
        orderId="577"
        orderCode="ORD-854857"
        customerName="Senor Miguel"
        customerPhone="9197576858"
        initialCallResult="no_answer"
        initialPartStatus="not_installed"
      />
    );

    // Should NOT contain piece status or warranty fields
    expect(html).not.toContain('Estado Físico / Montaje de la Pieza');
    expect(html).not.toContain('Advertencia Verbal de Garantía Obligatoria');
    expect(html).not.toContain('¿Para qué fecha prometió instalar?');

    // Should contain informative banner and mandatory explanation note
    expect(html).toContain('Sin contacto directo con el cliente');
    expect(html).toContain('Detalle del Intento de Contacto (Obligatorio)');
    expect(html).toContain('Es obligatorio dejar constancia escrita de la llamada no concretada');
    expect(html).toContain('Timbró varias veces y cayó en buzón de voz');
    expect(html).toContain('Guardar Registro');
  });

  it('hides piece status when line is busy and provides appropriate explanation prompt', () => {
    const html = renderToStaticMarkup(
      <RegisterFollowupCallModal
        isOpen={true}
        onClose={vi.fn()}
        orderId="577"
        orderCode="ORD-854857"
        customerName="Senor Miguel"
        customerPhone="9197576858"
        initialCallResult="busy"
      />
    );

    expect(html).not.toContain('Estado Físico / Montaje de la Pieza');
    expect(html).toContain('Sin contacto directo con el cliente');
    expect(html).toContain('Tono ocupado continuamente');
    expect(html).toContain('Guardar Registro');
  });

  it('hides piece status when number is wrong and prompts operator to describe findings', () => {
    const html = renderToStaticMarkup(
      <RegisterFollowupCallModal
        isOpen={true}
        onClose={vi.fn()}
        orderId="577"
        orderCode="ORD-854857"
        customerName="Senor Miguel"
        customerPhone="9197576858"
        initialCallResult="wrong_number"
      />
    );

    expect(html).not.toContain('Estado Físico / Montaje de la Pieza');
    expect(html).toContain('Sin contacto directo con el cliente');
    expect(html).toContain('Atendió persona ajena indicando número equivocado');
    expect(html).toContain('Guardar Registro');
  });

  it('renders WhatsApp channel with message template, click-to-send action, and WhatsApp outcome options', () => {
    const html = renderToStaticMarkup(
      <RegisterFollowupCallModal
        isOpen={true}
        onClose={vi.fn()}
        orderId="577"
        orderCode="ORD-854857"
        customerName="Senor Miguel"
        customerPhone="9197576858"
        vehicle="2009 TOYOTA Corolla"
        mainPart="Transmisión"
        daysSinceDelivery={3}
        initialContactChannel="whatsapp"
      />
    );

    // Channel toggle
    expect(html).toContain('Canal de Comunicación');
    expect(html).toContain('WhatsApp');
    expect(html).toContain('SMS (Texto)');
    expect(html).toContain('Llamada');

    // WhatsApp template assistant box with business branding and requested wording
    expect(html).toContain('Plantilla de Mensaje Sugerida (WhatsApp)');
    expect(html).toContain('Rodriguez Salvage Yard');
    expect(html).toContain('Queremos consultar cómo va todo con su transmission');
    expect(html).toContain('Recuerde que cualquier observación o duda puede notificarnos');
    expect(html).toContain('estamos aqui con gusto para ayudarle en lo que necesite. Saludos.');
    expect(html).toContain('Estándar');
    expect(html).toContain('Recepción');
    expect(html).toContain('Rodaje');
    expect(html).toContain('Abrir en WhatsApp');
    expect(html).toContain('Copiar Texto');
    expect(html).toContain('Insertar en Notas');
    expect(html).toContain('wa.me/19197576858');

    // Outcome options for WhatsApp
    expect(html).toContain('Resultado del Seguimiento por WhatsApp');
    expect(html).toContain('Cliente respondió el mensaje');
    expect(html).toContain('Mensaje enviado (Esperando respuesta)');
    expect(html).toContain('Mensaje enviado (Sin respuesta del cliente)');
  });

  it('renders SMS channel with tailored labels and outcome options', () => {
    const html = renderToStaticMarkup(
      <RegisterFollowupCallModal
        isOpen={true}
        onClose={vi.fn()}
        orderId="577"
        orderCode="ORD-854857"
        customerName="Senor Miguel"
        customerPhone="9197576858"
        daysSinceDelivery={5}
        initialContactChannel="sms"
      />
    );

    expect(html).toContain('Resultado del Mensaje de Texto');
    expect(html).toContain('Plantilla de Mensaje Sugerida (SMS)');
    expect(html).toContain('Copiar Texto');
  });

  it('renders safely when customerPhone is passed as number', () => {
    expect(() => {
      renderToStaticMarkup(
        <RegisterFollowupCallModal
          isOpen={true}
          onClose={vi.fn()}
          orderId="577"
          orderCode="ORD-854857"
          customerName="Senor Miguel"
          customerPhone={9197576858 as any}
          vehicle="2009 TOYOTA Corolla"
          mainPart="Transmisión"
          daysSinceDelivery={5}
        />
      );
    }).not.toThrow();
  });

  it('renders safely when vehicle is passed as an object', () => {
    expect(() => {
      renderToStaticMarkup(
        <RegisterFollowupCallModal
          isOpen={true}
          onClose={vi.fn()}
          orderId="577"
          orderCode="ORD-854857"
          customerName="Senor Miguel"
          customerPhone="9197576858"
          vehicle={{ year: 2009, make: 'TOYOTA', model: 'Corolla' } as any}
          mainPart="Transmisión"
          daysSinceDelivery={5}
        />
      );
    }).not.toThrow();
  });

  it('preserves hook count integrity between isOpen false and isOpen true', () => {
    const TestModalToggle = ({ isOpen }: { isOpen: boolean }) => (
      <RegisterFollowupCallModal
        isOpen={isOpen}
        onClose={vi.fn()}
        orderId="577"
        orderCode="ORD-854857"
        customerName="Senor Miguel"
        customerPhone="9197576858"
        vehicle="2009 TOYOTA Corolla"
        mainPart="Transmisión"
        daysSinceDelivery={5}
      />
    );

    expect(() => {
      renderToStaticMarkup(<TestModalToggle isOpen={false} />);
      renderToStaticMarkup(<TestModalToggle isOpen={true} />);
    }).not.toThrow();
  });

  it('renders customer language badge and English templates when customerLanguage is "en"', () => {
    const html = renderToStaticMarkup(
      <RegisterFollowupCallModal
        isOpen={true}
        onClose={vi.fn()}
        orderId="577"
        orderCode="ORD-854857"
        customerName="John Doe"
        customerPhone="9197576858"
        customerLanguage="en"
        vehicle="2018 FORD F-150"
        mainPart="Motor"
        daysSinceDelivery={4}
        initialContactChannel="whatsapp"
      />
    );

    // Header language badge
    expect(html).toContain('🇺🇸 Habla Inglés');

    // Language pills in template box
    expect(html).toContain('🇪🇸 ES');
    expect(html).toContain('🇺🇸 EN');

    // English template wording
    expect(html).toContain('Hello John Doe, this is Rodriguez Salvage Yard regarding your order ORD-854857 (2018 FORD F-150 - Engine)');
    expect(html).toContain('We wanted to check in and see how everything is going with your engine.');
    expect(html).toContain('Please remember that if you have any questions or concerns you can reach out, and we are happy to help you with anything you need. Best regards.');
  });

  it('renders transmission in English template when part is Transmisión', () => {
    const html = renderToStaticMarkup(
      <RegisterFollowupCallModal
        isOpen={true}
        onClose={vi.fn()}
        orderId="578"
        orderCode="ORD-854858"
        customerName="Michael Scott"
        customerPhone="9197576858"
        customerLanguage="en"
        vehicle="2015 CHEVROLET Silverado"
        mainPart="Transmisión"
        daysSinceDelivery={2}
        initialContactChannel="whatsapp"
      />
    );

    expect(html).toContain('2015 CHEVROLET Silverado - Transmission');
    expect(html).toContain('We wanted to check in and see how everything is going with your transmission.');
  });
});

