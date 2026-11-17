import { describe, expect, it } from 'vitest';
import {
  buildPbxQaPrompt,
  extractWavDurationSeconds,
  normalizeGeminiQaPayload,
  resolvePbxAudioFileMeta,
} from '../src/server/pbxAudioQa';

describe('PBX Audio QA with Gemini', () => {
  it('resolves supported audio file extensions and mime types', () => {
    expect(resolvePbxAudioFileMeta('call.wav', 'audio/x-wav')).toEqual({
      ext: '.wav',
      mimeType: 'audio/x-wav',
    });
    expect(resolvePbxAudioFileMeta('recording.mp3', '')).toEqual({
      ext: '.mp3',
      mimeType: 'audio/mpeg',
    });
    expect(resolvePbxAudioFileMeta(null, 'audio/mp4')).toEqual({
      ext: '.m4a',
      mimeType: 'audio/mp4',
    });
    expect(resolvePbxAudioFileMeta('notes.txt', 'text/plain')).toBeNull();
  });

  it('normalizes Gemini JSON response even when wrapped in markdown fences', () => {
    const raw = `\`\`\`json
    {
      "verdict": "incorrecta",
      "score": 30,
      "summary": "No saludó con Rodriguez Salvage Yard ni buscó en Car-Part.",
      "failureReasons": ["Sin saludo oficial", "Respondió no tengo de inmediato"],
      "checklist": {
        "officialGreeting": { "passed": false, "note": "Solo dijo Hello" },
        "askedNeed": { "passed": true, "note": "Preguntó para qué carro" },
        "realInventorySearch": { "passed": false, "note": "No esperó ni buscó en Car-Part" },
        "priceAndMilesIfAvailable": { "passed": true, "note": "No aplica" },
        "courteousGoodbye": { "passed": false, "note": "No se despidió" }
      },
      "transcript": "Agente: Hello\\nCliente: Honda Civic 2001"
    }
    \`\`\``;

    const result = normalizeGeminiQaPayload(raw);
    expect(result.verdict).toBe('incorrecta');
    expect(result.score).toBe(30);
    expect(result.failureReasons).toEqual([
      'Sin saludo oficial',
      'Respondió no tengo de inmediato',
    ]);
    expect(result.checklist.officialGreeting.passed).toBe(false);
    expect(result.checklist.askedNeed.passed).toBe(true);
    expect(result.transcript).toContain('Honda Civic 2001');
  });

  it('includes Rodriguez Salvage Yard, Car-Part, and minimum call duration rules in prompt', () => {
    const prompt = buildPbxQaPrompt(24.4);
    expect(prompt).toContain('Rodriguez Salvage Yard');
    expect(prompt).toContain('Car-Part');
    expect(prompt).toContain('Precio y millas');
    expect(prompt).toContain('24.4 segundos');
    expect(prompt).toContain('30 a 45 segundos');
  });

  it('extracts WAV duration from RIFF/WAVE header', () => {
    const buf = Buffer.alloc(44 + 16000 * 10);
    buf.write('RIFF', 0, 'ascii');
    buf.writeUInt32LE(buf.length - 8, 4);
    buf.write('WAVE', 8, 'ascii');
    buf.write('fmt ', 12, 'ascii');
    buf.writeUInt32LE(16, 16);
    buf.writeUInt32LE(16000, 28); // byteRate = 16000 B/s
    buf.write('data', 36, 'ascii');
    buf.writeUInt32LE(16000 * 10, 40);
    expect(extractWavDurationSeconds(buf)).toBe(10);
  });
});
