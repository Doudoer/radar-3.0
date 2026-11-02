import { getBackupFileContent, listBackups } from '../src/server/backup';

const REQUIRED_TABLES = ['users', 'orders', 'customers', 'claims', 'inventory_parts'];

export interface IntegrityReport {
  ok: boolean;
  filename: string;
  sizeBytes: number;
  tablesFound: string[];
  missingTables: string[];
  insertStatementsCount: number;
  hasForeignKeysHandling: boolean;
  issues: string[];
}

export const parseSqlIntegrity = (sql: string, filename: string, sizeBytes: number): IntegrityReport => {
  if (sizeBytes === 0 || !sql.trim()) {
    return {
      ok: false,
      filename,
      sizeBytes,
      tablesFound: [],
      missingTables: REQUIRED_TABLES,
      insertStatementsCount: 0,
      hasForeignKeysHandling: false,
      issues: ['El archivo de respaldo está vacío (0 bytes).'],
    };
  }

  const issues: string[] = [];

  // 1. Check foreign keys handling
  const hasForeignKeysHandling = sql.includes('FOREIGN_KEY_CHECKS');
  if (!hasForeignKeysHandling) {
    issues.push('Advertencia: El respaldo no incluye directivas SET FOREIGN_KEY_CHECKS.');
  }

  // 2. Extract CREATE TABLE matches
  const tableMatches = Array.from(sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`?(\w+)`?)/gi));
  const tablesFound = Array.from(new Set(tableMatches.map((m) => m[1].toLowerCase())));

  // 3. Count INSERT statements
  const insertMatches = sql.match(/INSERT\s+INTO\s+/gi) || [];
  const insertStatementsCount = insertMatches.length;

  // 4. Verify required tables
  const missingTables = REQUIRED_TABLES.filter((t) => !tablesFound.includes(t.toLowerCase()));
  if (missingTables.length > 0) {
    issues.push(`Tablas críticas no encontradas en el dump: ${missingTables.join(', ')}`);
  }

  const ok = issues.length === 0 && tablesFound.length >= REQUIRED_TABLES.length;

  return {
    ok,
    filename,
    sizeBytes,
    tablesFound,
    missingTables,
    insertStatementsCount,
    hasForeignKeysHandling,
    issues,
  };
};

export const checkBackupIntegrity = async (targetFile?: string): Promise<IntegrityReport> => {
  let selectedFile = targetFile;

  if (!selectedFile) {
    const backups = await listBackups();
    if (backups.length === 0) {
      throw new Error('No se encontraron archivos de respaldo en la carpeta backups/');
    }
    selectedFile = backups[0].filename;
  }

  const { sql, resolvedPath } = await getBackupFileContent(selectedFile);
  return parseSqlIntegrity(sql, resolvedPath.split('/').pop()!, Buffer.byteLength(sql, 'utf8'));
};

const run = async () => {
  console.log('\n======================================================');
  console.log(' 🔍 RADAR 3.0 - AUDITORÍA DE INTEGRIDAD DE RESPALDOS');
  console.log('======================================================\n');

  try {
    const fileArg = process.argv[2];
    const report = await checkBackupIntegrity(fileArg);

    console.log(`📁 Archivo auditado: ${report.filename}`);
    console.log(`💾 Tamaño: ${(report.sizeBytes / 1024).toFixed(2)} KB`);
    console.log(`📊 Tablas detectadas (${report.tablesFound.length}): ${report.tablesFound.join(', ')}`);
    console.log(`📝 Total de sentencias INSERT: ${report.insertStatementsCount}`);
    console.log(`🔒 Control de Claves Foráneas: ${report.hasForeignKeysHandling ? 'Sí' : 'No'}`);

    if (report.issues.length > 0) {
      console.log('\n⚠️ Incidencias detectadas:');
      report.issues.forEach((issue) => console.log(`  - ${issue}`));
    }

    console.log('------------------------------------------------------');
    if (report.ok) {
      console.log(' ✅ ESTADO: Comprobación estructural aprobada; NO verifica restaurabilidad ni integridad de datos.');
      console.log(' Requiere importar en una base aislada y comparar esquema, conteos, relaciones y valores antes de considerarlo recuperable.');
    } else {
      console.log(' ❌ ESTADO: Respaldo con inconsistencias o tablas faltantes.');
    }
    console.log('======================================================\n');

    if (!report.ok) {
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error al verificar integridad del respaldo:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

if (process.argv[1]?.includes('verify-backup-integrity')) {
  void run();
}
