import { pool } from '../src/server/config';
import { saveBackupSnapshot } from '../src/server/backup';
import { wasender } from '../src/integrations/wasender/client';
import { dispatchSystemNotification } from '../src/integrations/wasender/notificationService';
import { formatRespaldoAutomaticoMessage } from '../src/integrations/wasender/notificationTemplates';

const main = async () => {
  console.log('🔄 Iniciando generación de respaldo programado de Radar 3.0...');
  const startTime = Date.now();

  try {
    const tag = process.argv[2] || 'cron_daily';
    const result = await saveBackupSnapshot({ tag });

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    const sizeMb = (result.sizeBytes / (1024 * 1024)).toFixed(2);

    console.log(`✅ Respaldo generado con éxito en ${durationSeconds}s`);
    console.log(`📁 Archivo: ${result.filename}`);
    console.log(`💾 Tamaño: ${sizeMb} MB (${result.sizeBytes} bytes)`);
    console.log(`📍 Ruta: ${result.path}`);

    // Dispatch WhatsApp Notification to Super Admin
    const appUrl = process.env.APP_URL || 'https://radar-rsy.site';
    const downloadUrl = `${appUrl}/api/system/backup/download?file=${encodeURIComponent(result.filename)}`;
    const notificationMessage = formatRespaldoAutomaticoMessage({ downloadUrl });

    try {
      await dispatchSystemNotification(pool, wasender, 'RESPALDO_AUTOMATICO', notificationMessage);
      console.log('📱 Notificación de respaldo enviada exitosamente por WhatsApp.');
    } catch (notificationError) {
      console.warn('⚠️ No se pudo enviar la notificación por WhatsApp (Wasender offline o no configurado):', notificationError);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error al generar el respaldo de base de datos:', error);
    process.exit(1);
  }
};

void main();
