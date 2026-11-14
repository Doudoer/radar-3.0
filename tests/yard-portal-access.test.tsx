import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { YardAccessNotice } from '../src/components/YardAccessNotice';
import { canAccessYardPortal, stripYardPortalFromUrl } from '../src/utils/yardPortal';

describe('yard portal role gate', () => {
  it('allows administrators and yard sellers only', () => {
    expect(canAccessYardPortal('admin')).toBe(true);
    expect(canAccessYardPortal('vendedor_yarda')).toBe(true);
    expect(canAccessYardPortal('Admin')).toBe(true);
    expect(canAccessYardPortal('operator')).toBe(false);
    expect(canAccessYardPortal('vendedor')).toBe(false);
    expect(canAccessYardPortal('')).toBe(false);
    expect(canAccessYardPortal(null)).toBe(false);
    expect(canAccessYardPortal(undefined)).toBe(false);
  });

  it('removes the portal flag without losing unrelated query params or hash', () => {
    expect(stripYardPortalFromUrl('http://127.0.0.1:3000/?portal=yard')).toBe('/');
    expect(stripYardPortalFromUrl('http://127.0.0.1:3000/?portal=yard&x=1')).toBe('/?x=1');
    expect(stripYardPortalFromUrl('http://127.0.0.1:3000/orders?portal=yard')).toBe('/orders');
    expect(stripYardPortalFromUrl('/?portal=yard')).toBe('/');
  });

  it('normalizes yard paths back to the office root', () => {
    expect(stripYardPortalFromUrl('http://127.0.0.1:3000/yard')).toBe('/');
    expect(stripYardPortalFromUrl('http://127.0.0.1:3000/YARD')).toBe('/');
    expect(stripYardPortalFromUrl('http://127.0.0.1:3000/yard?portal=yard&x=1#top')).toBe('/?x=1#top');
  });
});

describe('yard access notice', () => {
  const render = (props: Partial<React.ComponentProps<typeof YardAccessNotice>> = {}) => renderToStaticMarkup(
    <YardAccessNotice userName="Operador Uno" userRole="operator" onLogout={() => {}} {...props} />
  );

  it('explains the restriction and offers a logout exit', () => {
    const html = render();
    expect(html).toContain('Acceso de patio restringido');
    expect(html).toContain('Operador Uno');
    expect(html).toContain('operator');
    expect(html).toContain('Cerrar sesión');
    expect(html).not.toContain('rose-');
  });

  it('falls back to readable labels when user data is missing', () => {
    const html = render({ userName: undefined, userRole: undefined });
    expect(html).toContain('Sin identificar');
    expect(html).toContain('No registrado');
  });
});
