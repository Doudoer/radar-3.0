import fs from 'node:fs/promises';
import path from 'node:path';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import {
  getGeminiApiKey,
  getPbxCallByUniqueId,
  type PbxCallQaChecklistItem,
  type PbxCallQaResult,
  type PbxCallQaStatus,
  type PbxCallRecord,
} from './pbxCalls.js';

export const PBX_RECORDINGS_DIR = path.resolve(process.cwd(), 'uploads', 'pbx-recordings');
export const MAX_PBX_AUDIO_BYTES = 50 * 1024 * 1024;
export const INLINE_AUDIO_THRESHOLD_BYTES = 6 * 1024 * 1024;
export const GEMINI_QA_MODEL = 'gemini-2.5-flash';

const ALLOWED_AUDIO_MIME_BY_EXT: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
  '.aac': 'audio/aac',
};

const EXT_BY_AUDIO_MIME: Record<string, string> = {
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/m4a': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/ogg': '.ogg',
  'audio/webm': '.webm',
  'audio/aac': '.aac',
};

export const resolvePbxAudioFileMeta = (
  fileName?: string | null,
  mimeType?: string | null,
): { ext: string; mimeType: string } | null => {
  const cleanMime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const extFromName = path.extname(String(fileName || '')).toLowerCase();

  if (extFromName && ALLOWED_AUDIO_MIME_BY_EXT[extFromName]) {
    return {
      ext: extFromName,
      mimeType: cleanMime.startsWith('audio/') ? cleanMime : ALLOWED_AUDIO_MIME_BY_EXT[extFromName],
    };
  }
  if (cleanMime && EXT_BY_AUDIO_MIME[cleanMime]) {
    return {
      ext: EXT_BY_AUDIO_MIME[cleanMime],
      mimeType: cleanMime === 'audio/x-wav' || cleanMime === 'audio/wave' ? 'audio/wav' : cleanMime,
    };
  }
  return null;
};

const sanitizeChecklistItem = (raw: unknown, fallbackNote: string): PbxCallQaChecklistItem => {
  if (!raw || typeof raw !== 'object') {
    return { passed: null, note: fallbackNote };
  }
  const obj = raw as Record<string, unknown>;
  return {
    passed: typeof obj.passed === 'boolean' ? obj.passed : null,
    note: typeof obj.note === 'string' && obj.note.trim() ? obj.note.trim() : fallbackNote,
  };
};

export const normalizeGeminiQaPayload = (rawText: string, model = GEMINI_QA_MODEL): PbxCallQaResult => {
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  const rawVerdict = String(parsed.verdict || '').trim().toLowerCase();
  const verdict: 'correcta' | 'incorrecta' = rawVerdict === 'correcta' ? 'correcta' : 'incorrecta';
  const rawScore = Number(parsed.score);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : (verdict === 'correcta' ? 85 : 35);
  const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
    ? parsed.summary.trim()
    : (verdict === 'correcta' ? 'La llamada cumplió con el protocolo de atención.' : 'La llamada no cumplió con el protocolo de atención.');
  const failureReasons = Array.isArray(parsed.failureReasons)
    ? parsed.failureReasons.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const rawChecklist = (parsed.checklist && typeof parsed.checklist === 'object')
    ? (parsed.checklist as Record<string, unknown>)
    : {};

  return {
    verdict,
    score,
    summary,
    failureReasons,
    checklist: {
      officialGreeting: sanitizeChecklistItem(rawChecklist.officialGreeting, 'Sin evidencia del saludo oficial.'),
      askedNeed: sanitizeChecklistItem(rawChecklist.askedNeed, 'Sin evidencia de pregunta por pieza/vehículo.'),
      realInventorySearch: sanitizeChecklistItem(rawChecklist.realInventorySearch, 'Sin evidencia de búsqueda real en inventario/Car-Part.'),
      priceAndMilesIfAvailable: sanitizeChecklistItem(rawChecklist.priceAndMilesIfAvailable, 'No aplica o no se informó.'),
      courteousGoodbye: sanitizeChecklistItem(rawChecklist.courteousGoodbye, 'Sin despedida cordial.'),
    },
    transcript: typeof parsed.transcript === 'string' ? parsed.transcript.trim() : '',
    model,
  };
};

export const extractWavDurationSeconds = (buffer: Buffer): number | null => {
  if (buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  const byteRate = buffer.readUInt32LE(28);
  if (!byteRate) return null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      return Math.round((chunkSize / byteRate) * 10) / 10;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return Math.round(((buffer.length - 44) / byteRate) * 10) / 10;
};

export const buildPbxQaPrompt = (durationSeconds?: number | null): string => {
  const durationLine = durationSeconds && durationSeconds > 0
    ? `\nDURACIÓN REAL DEL AUDIO: **${durationSeconds} segundos**.`
    : '';
  return `
Eres el auditor de calidad telefónica de **Rodriguez Salvage Yard** (venta de autopartes usadas en EE. UU., atención en inglés y español).
Escucha atentamente el audio de la llamada (incluyendo pausas, tiempos de silencio, música de espera, tono y lo que dicen agente y cliente) y evalúa si el agente cumplió con el protocolo oficial de atención:${durationLine}

PROTOCOLO OBLIGATORIO DE RODRIGUEZ SALVAGE YARD Y TIEMPOS REALISTAS:
1. **Saludo oficial**: Al contestar, debe saludar mencionando **Rodriguez Salvage Yard** y preguntar en qué puede ayudar (ej. "Rodriguez Salvage Yard, how can I help you?"). Un simple "Hello" seco NO cumple.
2. **Identificar necesidad**: Preguntar o confirmar qué pieza y vehículo (año, marca, modelo) busca el cliente.
3. **Búsqueda real en Car-Part / Inventario y tiempo suficiente**:
   - Después de que el cliente indica el vehículo y la pieza, buscar realmente en Car-Part/inventario toma tiempo (filtrar año, marca, modelo, pieza y revisar resultados toma como mínimo **15 a 30 segundos** adicionales después de escuchar al cliente).
   - Sumando música/conexión inicial (~2-5 s) + saludo (~3-4 s) + cliente explicando (~5-10 s) + búsqueda real en Car-Part (~15-30 s) + respuesta y despedida (~5-7 s), una llamada correcta (incluso diciendo que NO tenemos la pieza) dura como mínimo **30 a 45 segundos** (normalmente 45-70 s).
   - Si la llamada dura **menos de ~30 segundos** (o el agente responde "no tengo" / "I don't have it" en 1-4 segundos sin pausa real ni preguntas técnicas), el tiempo fue **insuficiente** para verificar en Car-Part: **marca este punto como \`false\`** y explica explícitamente que la duración fue insuficiente para una búsqueda real.
4. **Precio y millas (si hay existencia)**:
   - Si indica que sí la tienen, debe dar precio y millas (\`passed: true\` si dio ambos, \`false\` si omitió alguno).
   - Si indica que no la tienen y SÍ hizo búsqueda real, usa \`passed: null\` ("No aplica: confirmó tras revisar que no estaba disponible").
   - Si indicó que no la tienen pero NO hizo búsqueda real en Car-Part, usa \`passed: null\` con nota "No aplica precio/millas (dijo no tenerla sin verificar en Car-Part)".
5. **Despedida cordial**: Cerrar cordialmente agradeciendo por llamar o deseando buen día.

Devuelve EXCLUSIVAMENTE un objeto JSON válido con esta estructura exacta (textos en español, transcripción en el idioma original hablado):
{
  "verdict": "correcta" | "incorrecta",
  "score": 0-100,
  "summary": "Resumen claro en 1-2 oraciones explicando el veredicto e indicando si el tiempo de la llamada fue suficiente o insuficiente.",
  "failureReasons": ["Motivo concreto 1", "Motivo concreto 2"],
  "checklist": {
    "officialGreeting": { "passed": true | false, "note": "Detalle breve" },
    "askedNeed": { "passed": true | false, "note": "Detalle breve" },
    "realInventorySearch": { "passed": true | false, "note": "Detalle breve incluyendo si el tiempo fue suficiente" },
    "priceAndMilesIfAvailable": { "passed": true | false | null, "note": "Detalle breve" },
    "courteousGoodbye": { "passed": true | false, "note": "Detalle breve" }
  },
  "transcript": "Transcripción o resumen cronológico de los intercambios clave (si la llamada es larga, máximo 20-25 líneas con los momentos principales)"
}

Regla de veredicto:
- Marca "incorrecta" si falla el saludo oficial, si el tiempo fue insuficiente para buscar realmente en Car-Part/inventario (ej. menos de ~30 s o respuesta inmediata sin revisar), si omite precio/millas cuando sí tiene la pieza, o si falta despedida cordial / es descortés.
- Si cumple todos los puntos esenciales del protocolo con tiempo suficiente, marca "correcta" y deja "failureReasons" vacío [].
`.trim();
};

const GEMINI_QA_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  required: ['verdict', 'score', 'summary', 'failureReasons', 'checklist', 'transcript'],
  properties: {
    verdict: { type: 'STRING', enum: ['correcta', 'incorrecta'] },
    score: { type: 'INTEGER' },
    summary: { type: 'STRING' },
    failureReasons: { type: 'ARRAY', items: { type: 'STRING' } },
    checklist: {
      type: 'OBJECT',
      required: [
        'officialGreeting',
        'askedNeed',
        'realInventorySearch',
        'priceAndMilesIfAvailable',
        'courteousGoodbye',
      ],
      properties: {
        officialGreeting: {
          type: 'OBJECT',
          required: ['passed', 'note'],
          properties: { passed: { type: 'BOOLEAN' }, note: { type: 'STRING' } },
        },
        askedNeed: {
          type: 'OBJECT',
          required: ['passed', 'note'],
          properties: { passed: { type: 'BOOLEAN' }, note: { type: 'STRING' } },
        },
        realInventorySearch: {
          type: 'OBJECT',
          required: ['passed', 'note'],
          properties: { passed: { type: 'BOOLEAN' }, note: { type: 'STRING' } },
        },
        priceAndMilesIfAvailable: {
          type: 'OBJECT',
          required: ['note'],
          properties: { passed: { type: 'BOOLEAN', nullable: true }, note: { type: 'STRING' } },
        },
        courteousGoodbye: {
          type: 'OBJECT',
          required: ['passed', 'note'],
          properties: { passed: { type: 'BOOLEAN' }, note: { type: 'STRING' } },
        },
      },
    },
    transcript: { type: 'STRING' },
  },
};

const uploadAudioToGeminiFilesApi = async (
  apiKey: string,
  audioBuffer: Buffer,
  mimeType: string,
  fetchImpl: typeof fetch,
): Promise<{ fileUri: string; fileName: string }> => {
  const uploadRes = await fetchImpl(
    'https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=media',
    {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(audioBuffer.length),
        'x-goog-api-key': apiKey,
      },
      body: new Uint8Array(audioBuffer),
      signal: AbortSignal.timeout(120_000),
    },
  );
  const uploadJson = await uploadRes.json().catch(() => ({})) as Record<string, any>;
  if (!uploadRes.ok || !uploadJson?.file?.uri) {
    throw new Error(uploadJson?.error?.message || `Error subiendo audio largo a Gemini (${uploadRes.status})`);
  }
  const fileUri = String(uploadJson.file.uri);
  const fileName = String(uploadJson.file.name || '');

  // Wait briefly if file is still PROCESSING
  if (uploadJson.file.state === 'PROCESSING' && fileName) {
    for (let i = 0; i < 15; i += 1) {
      await new Promise((r) => setTimeout(r, 1500));
      const checkRes = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/${fileName}`,
        { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(15_000) },
      );
      const checkJson = await checkRes.json().catch(() => ({})) as Record<string, any>;
      if (checkJson?.state === 'ACTIVE') break;
      if (checkJson?.state === 'FAILED') {
        throw new Error('Gemini no pudo procesar el archivo de audio largo.');
      }
    }
  }
  return { fileUri, fileName };
};

export const analyzeAudioBufferWithGemini = async (
  apiKey: string,
  audioBuffer: Buffer,
  mimeType: string,
  fetchImpl: typeof fetch = fetch,
  durationSecondsOverride?: number | null,
): Promise<PbxCallQaResult> => {
  const wavDuration = extractWavDurationSeconds(audioBuffer);
  const durationSeconds = wavDuration ?? (durationSecondsOverride && durationSecondsOverride > 0 ? durationSecondsOverride : null);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QA_MODEL}:generateContent`;

  let uploadedFileName = '';
  let mediaPart: Record<string, unknown>;
  if (audioBuffer.length > INLINE_AUDIO_THRESHOLD_BYTES) {
    const uploaded = await uploadAudioToGeminiFilesApi(apiKey, audioBuffer, mimeType, fetchImpl);
    uploadedFileName = uploaded.fileName;
    mediaPart = {
      fileData: {
        mimeType,
        fileUri: uploaded.fileUri,
      },
    };
  } else {
    mediaPart = {
      inlineData: {
        mimeType,
        data: audioBuffer.toString('base64'),
      },
    };
  }

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: buildPbxQaPrompt(durationSeconds) },
              mediaPart,
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: GEMINI_QA_RESPONSE_SCHEMA,
        },
      }),
      signal: AbortSignal.timeout(180_000),
    });

    const payload = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) {
      const errMsg = payload?.error?.message || `Gemini API respondió ${response.status}`;
      throw new Error(errMsg);
    }

    const parts = payload?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('\n').trim()
      : '';
    if (!text) {
      throw new Error('Gemini no devolvió contenido en el análisis del audio.');
    }
    return normalizeGeminiQaPayload(text, GEMINI_QA_MODEL);
  } finally {
    if (uploadedFileName) {
      void fetchImpl(`https://generativelanguage.googleapis.com/v1beta/${uploadedFileName}`, {
        method: 'DELETE',
        headers: { 'x-goog-api-key': apiKey },
      }).catch(() => {});
    }
  }
};

let recordingColumnsEnsured = false;

export const ensurePbxRecordingColumns = async (pool: Pool): Promise<void> => {
  if (recordingColumnsEnsured) return;
  try {
    await pool.execute(
      `ALTER TABLE pbx_call_logs
       ADD COLUMN IF NOT EXISTS recording_url VARCHAR(512) NULL,
       ADD COLUMN IF NOT EXISTS recording_mime_type VARCHAR(128) NULL,
       ADD COLUMN IF NOT EXISTS recording_uploaded_at DATETIME NULL,
       ADD COLUMN IF NOT EXISTS qa_status VARCHAR(24) NULL,
       ADD COLUMN IF NOT EXISTS qa_score INT NULL,
       ADD COLUMN IF NOT EXISTS qa_result LONGTEXT NULL,
       ADD COLUMN IF NOT EXISTS qa_analyzed_at DATETIME NULL`,
    );
    recordingColumnsEnsured = true;
  } catch (err: any) {
    // If columns already exist or user lacks ALTER privilege, let the actual query decide
    if (err?.code === 'ER_DUP_FIELDNAME') {
      recordingColumnsEnsured = true;
    }
  }
};

export const savePbxCallRecordingAndAnalyze = async (
  pool: Pool,
  params: {
    uniqueid: string;
    buffer: Buffer;
    fileName?: string | null;
    mimeType?: string | null;
  },
): Promise<{ call: PbxCallRecord; qaError?: string }> => {
  await ensurePbxRecordingColumns(pool);
  const existing = await getPbxCallByUniqueId(pool, params.uniqueid);
  if (!existing) {
    throw new Error('Llamada no encontrada.');
  }
  if (!params.buffer.length) {
    throw new Error('El archivo de audio está vacío.');
  }
  if (params.buffer.length > MAX_PBX_AUDIO_BYTES) {
    throw new Error('El audio supera el límite permitido de 50 MB.');
  }

  const meta = resolvePbxAudioFileMeta(params.fileName, params.mimeType);
  if (!meta) {
    throw new Error('Formato de audio no soportado. Usa WAV, MP3, M4A, OGG o WEBM.');
  }

  await fs.mkdir(PBX_RECORDINGS_DIR, { recursive: true });
  const safeId = params.uniqueid.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  const diskFilename = `${safeId}_${Date.now()}${meta.ext}`;
  const diskPath = path.join(PBX_RECORDINGS_DIR, diskFilename);
  await fs.writeFile(diskPath, params.buffer);

  const recordingUrl = `/api/pbx/calls/${encodeURIComponent(params.uniqueid)}/recording`;
  await pool.execute(
    `UPDATE pbx_call_logs
     SET recording_url = ?, recording_mime_type = ?, recording_uploaded_at = NOW(), qa_status = 'pending'
     WHERE uniqueid = ?`,
    [diskFilename, meta.mimeType, params.uniqueid],
  );

  // Store API-accessible URL in response, keep diskFilename in recording_url column or resolve via uniqueid
  void recordingUrl;
  return runPbxCallQaByUniqueId(pool, params.uniqueid, params.buffer, meta.mimeType);
};

export const getPbxCallRecordingDiskInfo = async (
  pool: Pool,
  uniqueid: string,
): Promise<{ filePath: string; mimeType: string } | null> => {
  await ensurePbxRecordingColumns(pool);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT recording_url, recording_mime_type FROM pbx_call_logs WHERE uniqueid = ? LIMIT 1',
    [uniqueid],
  );
  const stored = rows[0]?.recording_url ? String(rows[0].recording_url) : '';
  if (!stored) return null;
  const filename = path.basename(stored);
  const filePath = path.resolve(PBX_RECORDINGS_DIR, filename);
  if (!filePath.startsWith(PBX_RECORDINGS_DIR + path.sep)) return null;
  return {
    filePath,
    mimeType: rows[0]?.recording_mime_type ? String(rows[0].recording_mime_type) : 'audio/wav',
  };
};

export const runPbxCallQaByUniqueId = async (
  pool: Pool,
  uniqueid: string,
  bufferOverride?: Buffer,
  mimeTypeOverride?: string,
): Promise<{ call: PbxCallRecord; qaError?: string }> => {
  await ensurePbxRecordingColumns(pool);
  const apiKey = await getGeminiApiKey(pool);
  if (!apiKey) {
    await pool.execute(
      `UPDATE pbx_call_logs SET qa_status = 'pending' WHERE uniqueid = ?`,
      [uniqueid],
    );
    const updated = await getPbxCallByUniqueId(pool, uniqueid);
    if (!updated) throw new Error('Llamada no encontrada.');
    return {
      call: { ...updated, recordingUrl: `/api/pbx/calls/${encodeURIComponent(uniqueid)}/recording` },
      qaError: 'GEMINI_API_KEY no configurada. El audio se guardó pero no se pudo analizar.',
    };
  }

  let audioBuffer = bufferOverride;
  let mimeType = mimeTypeOverride;
  if (!audioBuffer) {
    const info = await getPbxCallRecordingDiskInfo(pool, uniqueid);
    if (!info) {
      throw new Error('Esta llamada no tiene grabación cargada.');
    }
    audioBuffer = await fs.readFile(info.filePath);
    mimeType = info.mimeType;
  }

  try {
    const existingCall = await getPbxCallByUniqueId(pool, uniqueid);
    const fallbackDuration = existingCall ? (existingCall.billsecSeconds || existingCall.durationSeconds || null) : null;
    const qaResult = await analyzeAudioBufferWithGemini(
      apiKey,
      audioBuffer,
      mimeType || 'audio/wav',
      fetch,
      fallbackDuration,
    );
    const qaStatus: PbxCallQaStatus = qaResult.verdict === 'correcta' ? 'correct' : 'incorrect';
    await pool.execute(
      `UPDATE pbx_call_logs
       SET qa_status = ?, qa_score = ?, qa_result = ?, qa_analyzed_at = NOW()
       WHERE uniqueid = ?`,
      [qaStatus, qaResult.score, JSON.stringify(qaResult), uniqueid],
    );
    const updated = await getPbxCallByUniqueId(pool, uniqueid);
    if (!updated) throw new Error('Llamada no encontrada.');
    return {
      call: { ...updated, recordingUrl: `/api/pbx/calls/${encodeURIComponent(uniqueid)}/recording` },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error analizando audio con Gemini';
    await pool.execute(
      `UPDATE pbx_call_logs SET qa_status = 'error' WHERE uniqueid = ?`,
      [uniqueid],
    );
    const updated = await getPbxCallByUniqueId(pool, uniqueid);
    if (!updated) throw new Error('Llamada no encontrada.');
    return {
      call: { ...updated, recordingUrl: `/api/pbx/calls/${encodeURIComponent(uniqueid)}/recording` },
      qaError: message,
    };
  }
};
