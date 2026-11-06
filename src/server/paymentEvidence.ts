import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { Claims } from './auth';
import { fail } from './business';

export async function assertUploadedOrderFiles(connection: PoolConnection, orderId: string | number, images: string[], claims: Claims, allowPdf = false) {
  for (const image of images) {
    const [files] = await connection.query<RowDataPacket[]>(
      'SELECT content_type,user_id FROM uploaded_files WHERE filename=? AND order_id=?',
      [image.slice('/uploads/'.length), orderId],
    );
    const expected = allowPdf && /\.pdf$/i.test(image) ? ['application/pdf'] : ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!files[0] || !expected.includes(files[0].content_type) ||
        claims.role !== 'admin' && Number(files[0].user_id) !== Number(claims.sub)) {
      fail(409, allowPdf ? 'El soporte debe estar subido para esta orden por ti o validado por administración.'
        : 'El comprobante debe ser una imagen subida para esta orden por ti o validada por administración.');
    }
  }
}

export const assertPaymentImages = (connection: PoolConnection, orderId: string | number, images: string[], claims: Claims) =>
  assertUploadedOrderFiles(connection, orderId, images, claims);
