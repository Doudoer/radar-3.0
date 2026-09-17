import { wasender, WasenderClient } from '../../integrations/wasender';
import { notificationConfig } from './config';
import { NotificationConfig, NotificationDispatchResult, NotificationEvent } from './types';

export class NotificationService {
  constructor(
    private readonly config: NotificationConfig = notificationConfig,
    private readonly wasenderClient: WasenderClient = wasender,
  ) {}

  async notify(event: NotificationEvent): Promise<NotificationDispatchResult> {
    const eventConfig = this.config.events[event.type];
    const channels = eventConfig.channels.filter((channel) => channel !== 'wasender' || this.config.wasenderEnabled);
    const result: NotificationDispatchResult = {
      eventType: event.type,
      channels,
      sent: 0,
      failed: 0,
      skipped: !this.config.enabled || !eventConfig.enabled || channels.length === 0,
    };

    if (result.skipped || !channels.includes('wasender')) return result;

    const recipients = event.recipients?.length
      ? event.recipients
      : eventConfig.recipients?.length
        ? eventConfig.recipients
        : this.config.defaultRecipients;

    if (recipients.length === 0 || !this.wasenderClient.configured) {
      result.skipped = true;
      return result;
    }

    const message = `*${event.title}*\n${event.message}`;
    const deliveries = await Promise.allSettled(
      recipients.map((to) => this.wasenderClient.sendText({ to, text: message }))
    );
    result.sent = deliveries.filter((delivery) => delivery.status === 'fulfilled').length;
    result.failed = deliveries.length - result.sent;
    return result;
  }

  notifyOrderStatus(orderId: string, status: string, message: string) {
    return this.notify({
      type: 'status',
      title: `Estado de orden actualizado: ${status}`,
      message,
      entityType: 'order',
      entityId: orderId,
    });
  }

  notifyClaim(orderId: string, message: string) {
    return this.notify({ type: 'claim', title: 'Reclamo de orden', message, entityType: 'claim', entityId: orderId });
  }

  notifyOrder(orderId: string, message: string) {
    return this.notify({ type: 'order', title: 'Actualización de orden', message, entityType: 'order', entityId: orderId });
  }
}

export const notificationService = new NotificationService();
