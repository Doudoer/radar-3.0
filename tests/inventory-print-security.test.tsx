import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InventoryPart } from '../src/types';
import { escapeHtml } from '../src/utils/html';
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useMemo: (factory: () => unknown) => factory(),
  useContext: () => ({ toast: vi.fn(), confirm: vi.fn(async () => true) }),
}));
import { InventoryPrintModal } from '../src/components/InventoryPrintModal';

type Props = { children?: React.ReactNode; onClick?: () => void };
function nodes(node: React.ReactNode): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...nodes(node.props.children)];
}
afterEach(() => vi.unstubAllGlobals());

describe('inventory report XSS regression', () => {
  it('escapes HTML, attribute delimiters and quotes', () => {
    expect(escapeHtml(`<script>"'&`)).toBe('&lt;script&gt;&quot;&#39;&amp;');
  });

  it('escapes every stored inventory field in the actual printable document', () => {
    const payload = `"><img src=x onerror=alert(1)><script>alert(2)</script>`;
    const item: InventoryPart = {
      id: '1', year: payload, yearFrom: payload, yearTo: payload, brand: payload, model: payload,
      partType: payload, vin: payload, palletNumber: payload, engineSpecs: payload, status: payload, notes: payload,
    };
    const write = vi.fn();
    const popup = {
      document: { open: vi.fn(), write, close: vi.fn() },
      addEventListener: vi.fn(), opener: {}, focus: vi.fn(), print: vi.fn(),
    };
    vi.stubGlobal('window', { open: () => popup });
    const tree = InventoryPrintModal({ isOpen: true, onClose: vi.fn(), items: [item] });
    if (tree instanceof Promise) throw new Error('Expected synchronous component');
    const button = nodes(tree).find(node => node.type === 'button' &&
      nodes(node).some(child => child.props.children === 'Imprimir Reporte (PDF)'));
    expect(button).toBeDefined();
    button!.props.onClick!();
    const html = String(write.mock.calls[0][0]);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain(payload);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('status-en_revision');
    expect(popup.opener).toBeNull();
    expect(popup.addEventListener).toHaveBeenCalledWith('load', expect.any(Function), { once: true });
  });
});
