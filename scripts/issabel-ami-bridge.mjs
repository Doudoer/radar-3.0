#!/usr/bin/env node
/**
 * Read-only Asterisk AMI -> Radar Webhook Bridge for Issabel PBX.
 * Runs on the Issabel VPS (connects locally to 127.0.0.1:5038) and forwards
 * inbound/outbound/answered/missed call events to Radar without touching PortSIP.
 *
 * Required env vars:
 *   RADAR_WEBHOOK_URL   e.g. https://tu-radar.com/api/pbx/events (or tunnel URL for local testing)
 *   PBX_WEBHOOK_SECRET  shared secret configured in Radar
 *   AMI_USER            read-only AMI username (e.g. radar_monitor)
 *   AMI_SECRET          AMI password
 * Optional:
 *   AMI_HOST=127.0.0.1
 *   AMI_PORT=5038
 */
import net from 'node:net';

const AMI_HOST = process.env.AMI_HOST || '127.0.0.1';
const AMI_PORT = Number(process.env.AMI_PORT || 5038);
const AMI_USER = process.env.AMI_USER || 'radar_monitor';
const AMI_SECRET = process.env.AMI_SECRET || '';
const RADAR_WEBHOOK_URL = process.env.RADAR_WEBHOOK_URL || '';
const PBX_WEBHOOK_SECRET = process.env.PBX_WEBHOOK_SECRET || '';

if (!AMI_SECRET || !RADAR_WEBHOOK_URL || !PBX_WEBHOOK_SECRET) {
  console.error('Faltan variables requeridas: AMI_SECRET, RADAR_WEBHOOK_URL, PBX_WEBHOOK_SECRET');
  process.exit(1);
}

const activeCalls = new Map();

const parseAmiBlock = (raw) => {
  const data = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    data[key] = val;
  }
  return data;
};

const sendToRadar = async (payload) => {
  try {
    const res = await fetch(RADAR_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-pbx-secret': PBX_WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[PBX Bridge] Error webhook:', res.status, text);
    }
  } catch (err) {
    console.error('[PBX Bridge] Error enviando evento a Radar:', err.message);
  }
};

const inferDirection = (ev) => {
  const ctx = String(ev.Context || '').toLowerCase();
  if (ctx.includes('from-trunk') || ctx.includes('from-pstn') || ctx.includes('ext-did')) return 'inbound';
  if (ctx.includes('from-internal') && String(ev.DestChannel || '').toLowerCase().includes('trunk')) return 'outbound';
  if (ctx.includes('from-internal')) return 'internal';
  return 'inbound';
};

const handleAmiEvent = (ev) => {
  const name = ev.Event;
  const uniqueid = ev.Linkedid || ev.Uniqueid;
  if (!uniqueid) return;

  if (name === 'DialBegin') {
    const direction = inferDirection(ev);
    const caller = ev.CallerIDNum || 'Desconocido';
    const dest = ev.DestCallerIDNum || ev.Exten || ev.DialString || '';
    const record = {
      uniqueid,
      direction,
      caller_number: caller,
      caller_name: ev.CallerIDName && ev.CallerIDName !== '<unknown>' ? ev.CallerIDName : null,
      destination: dest || null,
      answered: false,
    };
    activeCalls.set(uniqueid, record);
    if (direction === 'inbound') {
      void sendToRadar({
        uniqueid,
        event: 'ringing',
        direction,
        caller_number: record.caller_number,
        caller_name: record.caller_name,
        destination: record.destination,
        timestamp: new Date().toISOString(),
      });
    }
    return;
  }

  if (name === 'BridgeEnter' || (name === 'DialEnd' && ev.DialStatus === 'ANSWER')) {
    const existing = activeCalls.get(uniqueid);
    if (!existing || existing.answered) return;
    existing.answered = true;
    const ext = ev.DestCallerIDNum || ev.ConnectedLineNum || existing.destination || null;
    void sendToRadar({
      uniqueid,
      event: 'answered',
      direction: existing.direction,
      caller_number: existing.caller_number,
      caller_name: existing.caller_name,
      destination: existing.destination,
      answered_by_ext: ext,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (name === 'DialEnd' && ev.DialStatus && ev.DialStatus !== 'ANSWER') {
    const existing = activeCalls.get(uniqueid);
    if (!existing || existing.answered || existing.closed) return;
    existing.closed = true;
    void sendToRadar({
      uniqueid,
      event: 'missed',
      direction: existing.direction,
      caller_number: existing.caller_number,
      caller_name: existing.caller_name,
      destination: existing.destination,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (name === 'Hangup') {
    const existing = activeCalls.get(uniqueid);
    if (!existing || existing.closed) return;
    existing.closed = true;
    void sendToRadar({
      uniqueid,
      event: existing.answered ? 'ended' : 'missed',
      direction: existing.direction,
      caller_number: existing.caller_number,
      caller_name: existing.caller_name,
      destination: existing.destination,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (name === 'Cdr') {
    const disposition = String(ev.Disposition || '').toUpperCase();
    const status = disposition === 'ANSWERED' ? 'ended' : 'missed';
    const existing = activeCalls.get(uniqueid);
    const direction = existing?.direction || (String(ev.DestinationContext || '').includes('from-trunk') ? 'inbound' : 'outbound');
    activeCalls.delete(uniqueid);
    void sendToRadar({
      uniqueid,
      event: status,
      direction,
      caller_number: ev.Source || existing?.caller_number || 'Desconocido',
      caller_name: existing?.caller_name || null,
      destination: ev.Destination || existing?.destination || null,
      duration_seconds: Number(ev.Duration || 0),
      billsec_seconds: Number(ev.BillableSeconds || 0),
      timestamp: new Date().toISOString(),
    });
  }
};

const HEARTBEAT_URL = RADAR_WEBHOOK_URL.replace(/\/events\/?$/, '/heartbeat');

const sendHeartbeat = async (status, error = null) => {
  try {
    await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-pbx-secret': PBX_WEBHOOK_SECRET,
      },
      body: JSON.stringify({ status, error }),
    });
  } catch {
    // Ignore transient network errors during heartbeat
  }
};

const connect = () => {
  let heartbeatTimer = null;
  const socket = net.createConnection({ host: AMI_HOST, port: AMI_PORT }, () => {
    console.log(`[PBX Bridge] Conectado a AMI ${AMI_HOST}:${AMI_PORT}`);
    socket.write(
      `Action: Login\r\nUsername: ${AMI_USER}\r\nSecret: ${AMI_SECRET}\r\nEvents: call,cdr\r\n\r\n`,
    );
  });

  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\r\n\r\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 4);
      const parsed = parseAmiBlock(block);
      if (parsed.Response === 'Success' && parsed.Message === 'Authentication accepted') {
        void sendHeartbeat('online');
        if (!heartbeatTimer) {
          heartbeatTimer = setInterval(() => { void sendHeartbeat('online'); }, 30000);
        }
      } else if (parsed.Response === 'Error') {
        void sendHeartbeat('error', parsed.Message || 'Error de autenticación AMI');
      }
      if (parsed.Event) handleAmiEvent(parsed);
    }
  });

  socket.on('error', (err) => {
    console.error('[PBX Bridge] Error AMI:', err.message);
    void sendHeartbeat('error', err.message);
  });

  socket.on('close', () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    console.warn('[PBX Bridge] Conexión AMI cerrada, reintentando en 5s...');
    void sendHeartbeat('error', 'Conexión AMI cerrada');
    setTimeout(connect, 5000);
  });
};

connect();
