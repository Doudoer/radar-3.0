import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VaultUnlockModal } from '../src/components/VaultUnlockModal';
import { SystemSettingsView } from '../src/components/SystemSettingsView';

if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  };
}

describe('VaultUnlockModal & Disaster Recovery Vault Gate', () => {
  it('renders the 2FA unlock modal when open', () => {
    const html = renderToStaticMarkup(
      <VaultUnlockModal
        isOpen={true}
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );

    expect(html).toContain('horizon-modal');
    expect(html).toContain('Desbloquear Bóveda de Seguridad (2FA)');
    expect(html).toContain('Canal Seguro WhatsApp');
    expect(html).toContain('Solicitar Código por WhatsApp');
    expect(html).toContain('Authenticator');
    expect(html).toContain('8 Códigos');
    expect(html).toContain('Desbloquear Bóveda');
  });

  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      <VaultUnlockModal
        isOpen={false}
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );

    expect(html).toBe('');
  });

  it('renders disaster recovery header and backup controls for super admin', () => {
    const html = renderToStaticMarkup(
      <SystemSettingsView userRole="admin" />
    );

    expect(html).toContain('Centro de Respaldos &amp; Rollback (Disaster Recovery)');
    expect(html).toContain('Crear Respaldo Ahora');
    expect(html).toContain('Descarga Directa');
    expect(html).toContain('Desbloquear Bóveda');
  });
});
