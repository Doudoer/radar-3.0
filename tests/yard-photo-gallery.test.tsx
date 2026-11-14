import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { YardPhotoGallery } from '../src/components/YardPhotoGallery';

const images = ['/uploads/ref-1.jpg', '/uploads/ref-2.jpg'];

const render = (props: Partial<React.ComponentProps<typeof YardPhotoGallery>> = {}) =>
  renderToStaticMarkup(
    <YardPhotoGallery
      images={images}
      lightboxIndex={null}
      onLightboxIndexChange={() => undefined}
      {...props}
    />
  );

describe('yard photo gallery', () => {
  it('renders nothing without photos', () => {
    expect(render({ images: [] })).toBe('');
  });

  it('exposes every thumbnail as a labelled dialog trigger', () => {
    const html = render();
    expect(html).toContain('aria-label="Ver foto de referencia 1 de 2"');
    expect(html).toContain('aria-label="Ver foto de referencia 2 de 2"');
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(2);
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain('role="dialog"');
  });

  it('summarizes overflow on the last visible thumbnail', () => {
    const many = ['/1.jpg', '/2.jpg', '/3.jpg', '/4.jpg', '/5.jpg'];
    const html = render({ images: many, maxThumbnails: 2 });
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(2);
    expect(html).toContain('Ver foto de referencia 2 de 5');
    expect(html).toContain('+4');
  });

  it('opens a named, dismissible lightbox at the requested photo', () => {
    const html = render({ lightboxIndex: 0 });
    expect(html).toContain('yard-lightbox');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Fotos de referencia"');
    expect(html).toContain('aria-label="Cerrar visor"');
    expect(html).toContain('aria-label="Cerrar"');
    expect(html).toContain('1 / 2');
    expect(html).toContain('aria-label="Foto anterior"');
    expect(html).toContain('aria-label="Foto siguiente"');
  });
});
