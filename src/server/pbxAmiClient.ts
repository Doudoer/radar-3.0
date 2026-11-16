import net from 'node:net';
import type { Pool } from 'mysql2/promise';
import {
  closeOrphanedPbxCalls,
  listActiveIncomingCalls,
  parseCallerLanguageAndName,
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
  ivr_language: string | null;
  destination: string | null;
  queue_name: string | null;
  rootChannel?: string;
  answeredChannel?: string;
  answeredExt?: string | null;
  rejectedExts: Set<string>;
  answered: boolean;
  closed?: boolean;
  startedAtMs: number;
  answeredAtMs?: number;
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

const isRealEndpointChannel = (channel: string | undefined): boolean => {
  if (!channel) return false;
  const upper = channel.toUpperCase();
  if (upper.startsWith('LOCAL/')) return false;
  return upper.startsWith('PJSIP/') || upper.startsWith('SIP/') || upper.startsWith('IAX2/') || upper.startsWith('DAHDI/');
};

const extractExtFromChannel = (channel: string | undefined): string | null => {
  if (!channel || !isRealEndpointChannel(channel)) return null;
  const match = channel.match(/^(?:PJSIP|SIP|IAX2)\/([0-9]{2,5})(?:-|$)/i);
  return match ? match[1] : null;
};

const digitsLen = (value: string | undefined): number => (value ? value.replace(/\D+/g, '').length : 0);

export const inferDirection = (ev: Record<string, string>): PbxCallDirection => {
  const ctx = String(ev.Context || '').toLowerCase();
  const destChan = String(ev.DestChannel || '').toLowerCase();
  const callerLen = digitsLen(ev.CallerIDNum);
  const destNum = ev.DestCallerIDNum || ev.Exten || '';
  const destLen = digitsLen(destNum);

  if (ctx.includes('from-trunk') || ctx.includes('from-pstn') || ctx.includes('ext-did') || ctx.includes('from-sip-external')) {
    return 'inbound';
  }
  if (ctx.includes('macro-dialout') || ctx.includes('outrt-')) {
    return 'outbound';
  }
  if (callerLen > 0 && callerLen <= 5 && destLen >= 7) {
    return 'outbound';
  }
  if (callerLen >= 7 && destLen > 0 && destLen <= 5) {
    return 'inbound';
  }
  if (ctx.includes('from-internal')) {
    if (destChan.includes('trunk') || destChan.includes('dahdi') || destLen >= 7) {
      return 'outbound';
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
  const busyExtensions = new Set<string>();

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
    busyExtensions.clear();
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

  const releaseTracked = (tracked: TrackedCall) => {
    if (tracked.answeredExt) {
      busyExtensions.delete(tracked.answeredExt);
    }
  };

  const handleAmiEvent = (ev: Record<string, string>) => {
    const name = ev.Event;
    const uniqueid = ev.Linkedid || ev.Uniqueid;
    if (!uniqueid) return;

    if (name === 'QueueCallerJoin') {
      const queue = (ev.Queue || '').trim() || null;
      const existing = activeCalls.get(uniqueid);
      const caller = existing?.caller_number || ev.CallerIDNum || 'Desconocido';
      const parsed = parseCallerLanguageAndName(caller, ev.CallerIDName);
      const tracked: TrackedCall = existing || {
        uniqueid,
        direction: 'inbound',
        caller_number: caller,
        caller_name: parsed.cleanName,
        ivr_language: parsed.ivrLanguage,
        destination: queue,
        queue_name: queue,
        rootChannel: isRealEndpointChannel(ev.Channel) ? ev.Channel : undefined,
        rejectedExts: new Set<string>(),
        answered: false,
        startedAtMs: Date.now(),
      };
      if (queue) {
        tracked.queue_name = queue;
        tracked.destination = queue;
      }
      if (!tracked.rootChannel && isRealEndpointChannel(ev.Channel)) {
        tracked.rootChannel = ev.Channel;
      }
      if (parsed.ivrLanguage && !tracked.ivr_language) tracked.ivr_language = parsed.ivrLanguage;
      if (parsed.cleanName && !tracked.caller_name) tracked.caller_name = parsed.cleanName;
      activeCalls.set(uniqueid, tracked);
      if (!tracked.answered && !tracked.closed) {
        void emitEvent({
          uniqueid,
          event: 'ringing',
          direction: tracked.direction,
          caller_number: tracked.caller_number,
          caller_name: tracked.caller_name,
          ivr_language: tracked.ivr_language,
          destination: tracked.destination,
          queue_name: tracked.queue_name,
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    if (name === 'DialBegin') {
      const existing = activeCalls.get(uniqueid);
      const direction = existing?.direction || inferDirection(ev);
      const caller = existing?.caller_number || ev.CallerIDNum || 'Desconocido';
      const parsed = parseCallerLanguageAndName(caller, ev.CallerIDName);
      const dest = ev.DestCallerIDNum || ev.Exten || ev.DialString || '';
      const tracked: TrackedCall = existing || {
        uniqueid,
        direction,
        caller_number: caller,
        caller_name: parsed.cleanName,
        ivr_language: parsed.ivrLanguage,
        destination: dest || null,
        queue_name: null,
        rootChannel: ev.Uniqueid === uniqueid && isRealEndpointChannel(ev.Channel) ? ev.Channel : undefined,
        rejectedExts: new Set<string>(),
        answered: false,
        startedAtMs: Date.now(),
      };
      if (!tracked.rootChannel && ev.Uniqueid === uniqueid && isRealEndpointChannel(ev.Channel)) {
        tracked.rootChannel = ev.Channel;
      }
      if (parsed.ivrLanguage && !tracked.ivr_language) tracked.ivr_language = parsed.ivrLanguage;
      if (parsed.cleanName && !tracked.caller_name) tracked.caller_name = parsed.cleanName;
      // Preserve Queue destination instead of overwriting with one of the 8 Ring-All extensions
      if (!tracked.queue_name && dest && digitsLen(dest) <= 5) {
        tracked.destination = dest;
      }
      activeCalls.set(uniqueid, tracked);
      if (!existing && !tracked.answered) {
        void emitEvent({
          uniqueid,
          event: 'ringing',
          direction,
          caller_number: tracked.caller_number,
          caller_name: tracked.caller_name,
          ivr_language: tracked.ivr_language,
          destination: tracked.destination,
          queue_name: tracked.queue_name,
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    const isExtensionBridgeEnter = (
      name === 'BridgeEnter'
      && ev.BridgeType !== 'holding'
      && Number(ev.BridgeNumChannels || 0) >= 2
      && isRealEndpointChannel(ev.Channel)
      && Boolean(ev.Uniqueid && ev.Uniqueid !== uniqueid)
      && digitsLen(ev.CallerIDNum) > 0
      && digitsLen(ev.CallerIDNum) <= 5
    );

    if (
      (name === 'DialEnd' && ev.DialStatus === 'ANSWER' && isRealEndpointChannel(ev.DestChannel))
      || (name === 'AgentConnect' && isRealEndpointChannel(ev.Interface || ev.MemberName))
      || isExtensionBridgeEnter
    ) {
      const existing = activeCalls.get(uniqueid);
      if (!existing || existing.answered || existing.closed) return;
      const ansChannel = ev.DestChannel || ev.Interface || ev.Channel || undefined;
      const ext = extractExtFromChannel(ansChannel)
        || ev.DestCallerIDNum
        || ev.ConnectedLineNum
        || ev.CallerIDNum
        || existing.destination
        || null;
      existing.answered = true;
      existing.answeredAtMs = Date.now();
      existing.answeredChannel = ansChannel;
      existing.answeredExt = ext;
      if (ext && digitsLen(ext) <= 5) {
        busyExtensions.add(ext);
      }
      void emitEvent({
        uniqueid,
        event: 'answered',
        direction: existing.direction,
        caller_number: existing.caller_number,
        caller_name: existing.caller_name,
        ivr_language: existing.ivr_language,
        destination: existing.queue_name || existing.destination,
        queue_name: existing.queue_name,
        answered_by_ext: ext,
        rejected_by_exts: [...existing.rejectedExts],
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Operator rejection detection: DialStatus BUSY or Hangup Cause 17 (User Busy) / 21 (Call Rejected) on extension leg
    const isRejectedDial = name === 'DialEnd' && ev.DialStatus === 'BUSY' && isRealEndpointChannel(ev.DestChannel);
    const isRejectedHangup = name === 'Hangup' && (ev.Cause === '17' || ev.Cause === '21') && isRealEndpointChannel(ev.Channel) && ev.Uniqueid !== uniqueid;
    if (isRejectedDial || isRejectedHangup) {
      const existing = activeCalls.get(uniqueid);
      if (existing && !existing.answered && !existing.closed) {
        const rejExt = extractExtFromChannel(isRejectedDial ? ev.DestChannel : ev.Channel);
        if (rejExt && !busyExtensions.has(rejExt) && !existing.rejectedExts.has(rejExt)) {
          existing.rejectedExts.add(rejExt);
          void emitEvent({
            uniqueid,
            event: 'ringing',
            direction: existing.direction,
            caller_number: existing.caller_number,
            caller_name: existing.caller_name,
            ivr_language: existing.ivr_language,
            destination: existing.queue_name || existing.destination,
            queue_name: existing.queue_name,
            rejected_by_exts: [...existing.rejectedExts],
            timestamp: new Date().toISOString(),
          });
        }
      }
      if (isRejectedDial) return;
    }

    if (name === 'QueueCallerAbandon') {
      const existing = activeCalls.get(uniqueid);
      if (!existing || existing.answered || existing.closed) return;
      existing.closed = true;
      releaseTracked(existing);
      const nowMs = Date.now();
      const durationSeconds = Math.max(0, Math.round((nowMs - existing.startedAtMs) / 1000));
      void emitEvent({
        uniqueid,
        event: 'missed',
        direction: existing.direction,
        caller_number: existing.caller_number,
        caller_name: existing.caller_name,
        ivr_language: existing.ivr_language,
        destination: existing.queue_name || existing.destination,
        queue_name: existing.queue_name,
        answered_by_ext: null,
        rejected_by_exts: [...existing.rejectedExts],
        duration_seconds: durationSeconds,
        billsec_seconds: 0,
        timestamp: new Date(nowMs).toISOString(),
      });
      return;
    }

    if (name === 'Hangup') {
      const existing = activeCalls.get(uniqueid);
      if (!existing || existing.closed) return;
      const isRootHangup = !ev.Uniqueid || ev.Uniqueid === uniqueid;
      const isRootChannelHangup = Boolean(existing.rootChannel && ev.Channel === existing.rootChannel);
      const isAnsweredChannelHangup = Boolean(existing.answered && existing.answeredChannel && ev.Channel === existing.answeredChannel);
      if (!isRootHangup && !isRootChannelHangup && !isAnsweredChannelHangup) return;

      existing.closed = true;
      releaseTracked(existing);
      const nowMs = Date.now();
      const durationSeconds = Math.max(0, Math.round((nowMs - existing.startedAtMs) / 1000));
      const billsecSeconds = existing.answeredAtMs ? Math.max(0, Math.round((nowMs - existing.answeredAtMs) / 1000)) : 0;
      void emitEvent({
        uniqueid,
        event: existing.answered ? 'ended' : 'missed',
        direction: existing.direction,
        caller_number: existing.caller_number,
        caller_name: existing.caller_name,
        ivr_language: existing.ivr_language,
        destination: existing.queue_name || existing.destination,
        queue_name: existing.queue_name,
        answered_by_ext: existing.answered ? existing.answeredExt || null : null,
        rejected_by_exts: [...existing.rejectedExts],
        duration_seconds: durationSeconds,
        billsec_seconds: billsecSeconds,
        timestamp: new Date(nowMs).toISOString(),
      });
      return;
    }

    if (name === 'Cdr') {
      const disposition = String(ev.Disposition || '').toUpperCase();
      const status = disposition === 'ANSWERED' ? 'ended' : 'missed';
      const existing = activeCalls.get(uniqueid);
      if (existing) releaseTracked(existing);
      const direction = existing?.direction || (String(ev.DestinationContext || '').includes('from-trunk') ? 'inbound' : 'outbound');
      activeCalls.delete(uniqueid);
      void emitEvent({
        uniqueid,
        event: status,
        direction,
        caller_number: ev.Source || existing?.caller_number || 'Desconocido',
        caller_name: existing?.caller_name || null,
        ivr_language: existing?.ivr_language || null,
        destination: existing?.queue_name || ev.Destination || existing?.destination || null,
        queue_name: existing?.queue_name || null,
        answered_by_ext: status === 'ended' ? existing?.answeredExt || null : null,
        rejected_by_exts: existing ? [...existing.rejectedExts] : [],
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
      if (!force && socket && !socket.destroyed && targetKey === currentKey) {
        return;
      }

      currentKey = targetKey;
      disconnectSocket();

      const client = net.createConnection({ host: settings.amiHost, port: settings.amiPort });
      socket = client;
      client.setTimeout(35000);
      let buffer = '';
      let loggedIn = false;

      client.on('connect', () => {
        client.write(
          `Action: Login\r\nUsername: ${settings.amiUser}\r\nSecret: ${amiSecret}\r\nEvents: on\r\n\r\n`,
        );
      });

      client.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let idx = buffer.indexOf('\r\n\r\n');
        while (idx !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 4);
          const parsed = parseAmiBlock(block);

          if (!loggedIn && parsed.Response === 'Success' && /Authentication accepted/i.test(parsed.Message || '')) {
            loggedIn = true;
            void recordPbxHeartbeat(pool, { status: 'online' });
            void closeOrphanedPbxCalls(pool).catch(() => {});
            heartbeatTimer = setInterval(() => {
              if (!client.destroyed) client.write('Action: Ping\r\n\r\n');
              void recordPbxHeartbeat(pool, { status: 'online' });
            }, 30000);
          } else if (!loggedIn && parsed.Response === 'Error') {
            const msg = parsed.Message || 'Autenticación AMI rechazada por Issabel';
            void recordPbxHeartbeat(pool, { status: 'error', error: msg });
          } else if (parsed.Event) {
            handleAmiEvent(parsed);
          }

          idx = buffer.indexOf('\r\n\r\n');
        }
      });

      client.on('timeout', () => {
        if (!client.destroyed) client.write('Action: Ping\r\n\r\n');
      });

      client.on('error', (err) => {
        const msg = err.message.includes('ETIMEDOUT')
          ? `Tiempo agotado conectando a ${settings.amiHost}:${settings.amiPort} (abre TCP ${settings.amiPort} para ${process.env.PUBLIC_VPS_IP || '46.225.4.89'} en el firewall de Issabel/VPS)`
          : err.message;
        void recordPbxHeartbeat(pool, { status: 'error', error: msg });
      });

      client.on('close', () => {
        if (socket === client) {
          socket = null;
        }
        clearTimers();
        scheduleReconnect();
      });
    } catch (err) {
      console.error('[PBX AMI] Error en refresh:', err);
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
