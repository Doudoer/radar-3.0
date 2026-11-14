import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve('src/horizon.css'), 'utf8');

describe('Horizon presentation contracts', () => {
  it('keeps every theme rule screen-only so printed documents retain their layout', () => {
    const sheet = postcss.parse(css);
    for (const node of sheet.nodes) {
      if (node.type === 'comment') continue;
      expect(node.type).toBe('atrule');
      if (node.type === 'atrule') {
        expect(node.name).toBe('media');
        expect(node.params).toBe('screen');
      }
    }
  });

  it('uses explicit modal hooks rather than styling all fullscreen fixed elements', () => {
    expect(css).not.toContain('#root [class~="fixed"][class~="inset-0"]');
    expect(css).toContain('.horizon-modal');
    for (const name of readdirSync(resolve('src/components')).filter(name => name.endsWith('.tsx'))) {
      const source = readFileSync(resolve('src/components', name), 'utf8');
      const overlays = source.match(/className="[^"]*\bfixed inset-0\b[^"]*"/g) || [];
      for (const overlay of overlays) {
        expect(overlay, `${name}: ${overlay}`).toMatch(/horizon-(modal|drawer-backdrop|loading)|yard-overlay|yard-lightbox|yard-discard-modal/);
      }
    }
  });

  it('paints the always-dark yard lightbox explicitly so the light theme cannot repaint it', () => {
    const indexCss = readFileSync(resolve('src/index.css'), 'utf8');
    expect(indexCss).toContain('#root .yard-lightbox');
    expect(indexCss).toContain('overscroll-behavior: contain');
  });

  it('preserves the icon font separately from the DM Sans content font', () => {
    expect(css).toContain("font-family: 'Material Symbols Outlined Variable'");
    expect(css).toContain("--font-inter: 'DM Sans Variable'");
  });
  it('does not infer a translucent background from opacity on unrelated text or borders', () => {
    expect(css.includes('[class*="/"]')).toBe(false);
  });
  it('applies the shared Horizon view contract beyond the dashboard', () => {
    for (const name of [
      'OrdersTableView', 'OrderDetailView', 'ClientsView', 'InventoryView',
      'ClaimsView', 'ClaimDetailView', 'RefundsView', 'RefundRequestView',
      'OperationsView', 'WeeklyRelationView', 'SystemSettingsView',
      'UsersManagementView', 'InvoiceView', 'DispatchLabelView',
    ]) {
      expect(readFileSync(resolve(`src/components/${name}.tsx`), 'utf8'), name).toContain('horizon-view');
    }
    expect(css).toContain('.horizon-view-header');
    expect(css).toContain('.horizon-detail-grid');
    expect(css).toContain('.horizon-dialog-section');
  });
});
