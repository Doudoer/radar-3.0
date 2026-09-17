export type NotificationEventType =
  | 'alert'
  | 'notification'
  | 'status'
  | 'order'
  | 'claim'
  | 'delivery'
  | 'invoice'
  | 'security'
  | 'system';

export type NotificationChannel = 'in_app' | 'wasender';

export interface NotificationEvent {
  type: NotificationEventType;
  title: string;
  message: string;
  recipients?: string[];
  entityId?: string;
  entityType?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface NotificationEventConfig {
  enabled: boolean;
  channels: NotificationChannel[];
  recipients?: string[];
}

export interface NotificationConfig {
  enabled: boolean;
  wasenderEnabled: boolean;
  defaultRecipients: string[];
  events: Record<NotificationEventType, NotificationEventConfig>;
}

export interface NotificationDispatchResult {
  eventType: NotificationEventType;
  channels: NotificationChannel[];
  sent: number;
  failed: number;
  skipped: boolean;
}
