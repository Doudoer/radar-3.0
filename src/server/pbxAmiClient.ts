import net from 'node:net';
import type { Pool } from 'mysql2/promise';
import {
  listActiveIncomingCalls,
  readPbxSettings,
  recordPbxHeartbeat,
  upsertPbxCallEvent,
  type PbxCallDirection,
  type PbxCallRecord,
} from './pbxCalls';

interface TrackedCall {
  uniqueid: string;
  direction: PbxCallDirection;
  caller_number: string;
  caller_name: string | null;
  destination: string | null;
  answered: boolean;
  closed?: boolean;
}

export const parseAmiBlock = (raw: string): Record<string, string> => {
  const data: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    data[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return data;
};

export const inferDirection = (ev: Record<string, string>): PbxCallDirection => {
  const ctx = String(ev.Context || '').toLowerCase();
  const destChan = String(ev.DestChannel || '').toLowerCase();
  const chan = String(ev.Channel || '').toLowerCase();
  if (ctx.includes('from-trunk') || ctx.includes('from-pstn') || ctx.includes('ext-did')) return 'inbound';
  if (ctx.includes('from-internal')) {
    if (destChan.includes('trunk') || destChan.includes('dahdi') || (ev.DestCallerIDNum && ev.DestCallerIDNum.length >= 7)) {
      return 'outbound';
    }
    if (chan.startsWith('pjsip/') || chan.startsWith('sip/')) {
      return ev.DestCallerIDNum && ev.DestCallerIDNum.length >= 7 ? 'outbound' : 'internal';
    }
    return 'internal';
  }
  return 'inbound';
};

export interface PbxAmiManager {
  refresh: (force?: boolean) => Promise<void>;
  stop: () => void;
}

export const createPbxAmiManager = (
  pool: Pool,
  onActiveChanged: (active: PbxCallRecord[], enabled: boolean) => void,
): PbxAmiManager => {
  let socket: net.Socket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let currentKey = '';
  const activeCalls = new Map<string, TrackedCall>();

  const clearTimers = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const disconnectSocket = () => {
    clearTimers();
    if (socket) {
      socket.removeAllListeners();
      socket.destroy();
      socket = null;
    }
    activeCalls.clear();
  };

  const emitEvent = async (input: Parameters<typeof upsertPbxCallEvent>[1]) => {
    try {
      const settings = await readPbxSettings(pool);
      if (!settings.enabled) return;
      await upsertPbxCallEvent(pool, input);
      const active = settings.liveAlertsEnabled ? await listActiveIncomingCalls(pool) : [];
      onActiveChanged(active, settings.enabled);
    } catch (err) {
      console.error('[PBX AMI] Error procesando evento:', err);
    }
  };

  const handleAmiEvent = (ev: Record<string, string>) => {
    const name = ev.Event;
    const uniqueid = ev.Linkedid || ev.Uniqueid;
    if (!uniqueid) return;

    if (name === 'DialBegin') {
      const direction = inferDirection(ev);
      const caller = ev.CallerIDNum || 'Desconocido';
      const dest = ev.DestCallerIDNum || ev.Exten || ev.DialString || '';
      const tracked: TrackedCall = {
        uniqueid,
        direction,
        caller_number: caller,
        caller_name: ev.CallerIDName && ev.CallerIDName !== '<unknown>' ? ev.CallerIDName : null,
        destination: dest || null,
        answered: false,
      };
      activeCalls.set(uniqueid, tracked);
      void emitEvent({
        uniqueid,
        event: 'ringing',
        direction,
        caller_number: tracked.caller_number,
        caller_name: tracked.caller_name,
        destination: tracked.destination,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (name === 'BridgeEnter' || (name === 'DialEnd' && ev.DialStatus === 'ANSWER')) {
      const existing = activeCalls.get(uniqueid);
      if (!existing || existing.answered) return;
      existing.answered = true;
      const ext = ev.DestCallerIDNum || ev.ConnectedLineNum || existing.destination || null;
      void emitEvent({
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
      void emitEvent({
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
      void emitEvent({
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
      void emitEvent({
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

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void refresh();
    }, 8000);
  };

  const refresh = async (force = false) => {
    if (stopped) return;
    try {
      const settings = await readPbxSettings(pool);
      const amiSecret = settings.amiSecretValue;
      if (!settings.enabled || !settings.amiHost || !settings.amiUser || !amiSecret) {
        currentKey = '';
        disconnectSocket();
        return;
      }

      const targetKey = `${settings.amiHost}:${settings.amiPort}:${settings.amiUser}:${amiSecret}`;
      if (!force && socket && !socket.destroyed && currentKey === targetKey) {
        return;
      }

      disconnectSocket();
      currentKey = targetKey;
      let connected = false;

      const conn = net.createConnection({ host: settings.amiHost, port: settings.amiPort }, () => {
        connected = true;
        conn.setTimeout(60000);
        conn.write(
          `Action: Login\r\nUsername: ${settings.amiUser}\r\nSecret: ${amiSecret}\r\nEvents: call,cdr\r\n\r\n`,
        );
      });
      conn.setTimeout(5000);
      socket = conn;

      let buffer = '';
      conn.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let idx;
        while ((idx = buffer.indexOf('\r\n\r\n')) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 4);
          const parsed = parseAmiBlock(block);
          if (parsed.Response === 'Success' && parsed.Message === 'Authentication accepted') {
            void recordPbxHeartbeat(pool, { status: 'online' });
            if (!heartbeatTimer) {
              heartbeatTimer = setInterval(() => {
                void recordPbxHeartbeat(pool, { status: 'online' });
              }, 30000);
            }
          } else if (parsed.Response === 'Error') {
            void recordPbxHeartbeat(pool, {
              status: 'error',
              error: parsed.Message || 'Error de autenticación AMI en Issabel',
            });
          }
          if (parsed.Event) handleAmiEvent(parsed);
        }
      });

      conn.on('timeout', () => {
        if (!connected) {
          void recordPbxHeartbeat(pool, {
            status: 'error',
            error: `Tiempo agotado conectando a ${settings.amiHost}:${settings.amiPort} (abre TCP ${settings.amiPort} para 46.225.4.89 en el firewall de Issabel/VPS)`,
          });
          conn.destroy();
          return;
        }
        conn.write('Action: Ping\r\n\r\n');
      });

      conn.on('error', (err) => {
        void recordPbxHeartbeat(pool, {
          status: 'error',
          error: `AMI ${settings.amiHost}:${settings.amiPort}: ${err.message}`,
        });
      });

      conn.on('close', () => {
        clearTimers();
        if (socket === conn) socket = null;
        scheduleReconnect();
      });
    } catch (err) {
      console.error('[PBX AMI] Error iniciando conexión:', err);
      scheduleReconnect();
    }
  };

  return {
    refresh,
    stop: () => {
      stopped = true;
      disconnectSocket();
    },
  };
};
