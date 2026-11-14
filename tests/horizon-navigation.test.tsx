import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Sidebar } from '../src/components/Sidebar';

describe('Horizon navigation preserves Radar access and routes', () => {
  it('marks only the selected destination and keeps claims and refunds separate', () => {
    const html = renderToStaticMarkup(<Sidebar currentScreen="reembolsos" userRole="admin" onNavigate={() => {}} />);
    expect(html).toContain('horizon-sidebar');
    expect(html).toContain('Navegación principal');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>.*?currency_exchange.*?Reembolsos/s);
    expect(html).toContain('Reclamos');
    expect(html).toContain('Relación Semanal');
  });
  it('keeps the vault destination hidden for operators', () => {
    const html = renderToStaticMarkup(<Sidebar currentScreen="ordenes" userRole="operator" onNavigate={() => {}} />);
    expect(html).not.toContain('Relación Semanal');
    expect(html).not.toContain('Sistema');
    expect(html).not.toContain('Usuarios');
    expect(html).toContain('Lista de Órdenes');
  });
  it('separates operational navigation from administration without dropping destinations', () => {
    const html = renderToStaticMarkup(<Sidebar currentScreen="dashboard" userRole="admin" onNavigate={() => {}} />);
    expect(html).toContain('aria-label="Operación"');
    expect(html).toContain('aria-label="Administración"');
    expect(html.match(/class="horizon-nav-item /g)).toHaveLength(11);
    expect(html).toContain('Mi trabajo de hoy');
  });
  it('preserves the mobile drawer and alias selection', () => {
    const html = renderToStaticMarkup(<Sidebar currentScreen="finanzas" userRole="admin" isOpenMobile onNavigate={() => {}} />);
    expect(html).toContain('translate-x-0');
    expect(html).toMatch(/aria-current="page"[^>]*>.*?domain.*?Relación Semanal/s);
  });
});
