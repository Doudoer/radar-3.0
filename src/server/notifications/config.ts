import { NotificationConfig, NotificationEventConfig, NotificationEventType } from './types';

const eventTypes: NotificationEventType[] = [
  'alert', 'notification', 'status', 'order', 'claim', 'delivery', 'invoice', 'security', 'system',
];

const asBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const asList = (value: string | undefined) =>
  (value || '').split(',').map((item) => item.trim()).filter(Boolean);

const defaultEventConfig = (type: NotificationEventType): NotificationEventConfig => ({
  enabled: asBoolean(process.env[`NOTIFICATIONS_${type.toUpperCase()}_ENABLED`], true),
  channels: asBoolean(process.env.NOTIFICATIONS_WASENDER_ENABLED, false) ? ['in_app', 'wasender'] : ['in_app'],
  recipients: asList(process.env[`NOTIFICATIONS_${type.toUpperCase()}_RECIPIENTS`]),
});

const readEventOverrides = () => {
  const raw = process.env.NOTIFICATIONS_EVENT_CONFIG;
  if (!raw) return {} as Record<string, Partial<NotificationEventConfig>>;
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<NotificationEventConfig>>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const createEvents = () => {
  const overrides = readEventOverrides();
  return Object.fromEntries(eventTypes.map((type) => [
    type,
    { ...defaultEventConfig(type), ...(overrides[type] || {}) },
  ])) as Record<NotificationEventType, NotificationEventConfig>;
};

export const notificationConfig: NotificationConfig = {
  enabled: asBoolean(process.env.NOTIFICATIONS_ENABLED, true),
  wasenderEnabled: asBoolean(process.env.NOTIFICATIONS_WASENDER_ENABLED, false),
  defaultRecipients: asList(process.env.NOTIFICATIONS_DEFAULT_RECIPIENTS),
  events: createEvents(),
};
