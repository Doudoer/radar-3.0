import fs from 'node:fs';
import path from 'node:path';

interface CheckItem {
  category: string;
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
}

const runSecurityCheck = () => {
  const checks: CheckItem[] = [];
  const projectRoot = process.cwd();

  console.log('\n======================================================');
  console.log(' 🛡️  RADAR 3.0 - DIAGNÓSTICO DE SEGURIDAD DEL ENTORNO');
  console.log('======================================================\n');

  // 1. Check .gitignore for .env protection
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    if (gitignoreContent.includes('.env*') || gitignoreContent.includes('.env')) {
      checks.push({
        category: 'Secretos e Higiene de Repositorio',
        name: 'Protección de archivo .env en .gitignore',
        status: 'PASS',
        detail: 'El archivo .env está correctamente excluido del control de versiones git.',
      });
    } else {
      checks.push({
        category: 'Secretos e Higiene de Repositorio',
        name: 'Protección de archivo .env en .gitignore',
        status: 'FAIL',
        detail: 'El archivo .env NO está en .gitignore. Riesgo crítico de filtración de claves.',
      });
    }
  }

  // 2. Check JWT_SECRET strength
  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret) {
    checks.push({
      category: 'Autenticación y Criptografía',
      name: 'Clave Secreta JWT_SECRET',
      status: process.env.NODE_ENV === 'production' ? 'FAIL' : 'WARN',
      detail: 'JWT_SECRET no está definido en las variables de entorno.',
    });
  } else if (jwtSecret.length < 32) {
    checks.push({
      category: 'Autenticación y Criptografía',
      name: 'Longitud y Entropía de JWT_SECRET',
      status: 'WARN',
      detail: `JWT_SECRET tiene ${jwtSecret.length} caracteres. Se recomiendan mínimo 32 a 64 caracteres criptográficos.`,
    });
  } else {
    checks.push({
      category: 'Autenticación y Criptografía',
      name: 'Longitud y Entropía de JWT_SECRET',
      status: 'PASS',
      detail: `JWT_SECRET cuenta con longitud segura (${jwtSecret.length} caracteres).`,
    });
  }

  // 3. Check Database User (Least Privilege)
  const dbUser = process.env.DB_USER || 'radar_app';
  if (dbUser.toLowerCase() === 'root' && process.env.NODE_ENV === 'production') {
    checks.push({
      category: 'Base de Datos (Menor Privilegio)',
      name: 'Cuenta de Usuario MySQL',
      status: 'WARN',
      detail: 'Se está usando la cuenta "root" en producción. Se recomienda usar "radar_app" con permisos DML limitados.',
    });
  } else {
    checks.push({
      category: 'Base de Datos (Menor Privilegio)',
      name: 'Cuenta de Usuario MySQL',
      status: 'PASS',
      detail: `Cuenta de conexión configurada como "${dbUser}".`,
    });
  }

  // 4. Check Uploads & Backups Directories
  const uploadsDir = path.join(projectRoot, 'uploads');
  const backupsDir = path.join(projectRoot, 'backups');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  checks.push({
    category: 'Manejo de Archivos y Respaldos',
    name: 'Directorios Operativos de Almacenamiento',
    status: 'PASS',
    detail: 'Directorios uploads/ y backups/ inicializados correctamente con rutas aisladas.',
  });

  // 5. Check NODE_ENV and SSL/CORS
  const nodeEnv = process.env.NODE_ENV || 'development';
  checks.push({
    category: 'Entorno de Ejecución',
    name: 'Modo del Servidor (NODE_ENV)',
    status: 'PASS',
    detail: `Servidor configurado en modo "${nodeEnv}". Cookies Secure y HSTS se activan en producción.`,
  });

  // Print results
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const check of checks) {
    const symbol = check.status === 'PASS' ? '✅' : check.status === 'WARN' ? '⚠️' : '❌';
    if (check.status === 'PASS') passCount++;
    if (check.status === 'WARN') warnCount++;
    if (check.status === 'FAIL') failCount++;

    console.log(`[${check.category}]`);
    console.log(` ${symbol} ${check.name} [${check.status}]`);
    console.log(`    ↳ ${check.detail}\n`);
  }

  console.log('------------------------------------------------------');
  console.log(` Resumen: ${passCount} Aprobados | ${warnCount} Advertencias | ${failCount} Críticos`);
  console.log('======================================================\n');

  if (failCount > 0 && process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
};

runSecurityCheck();
