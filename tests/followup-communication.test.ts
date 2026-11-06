import { describe, expect, it } from 'vitest';
import { communicationSchema, validateCommunication, followupTemplate, decodeCommunicationEvidence } from '../src/utils/followupCommunication';

describe('followup communication rules', () => {
  it('accepts optional message screenshots but rejects call attachments, nonimages and oversized lists', () => {
    for (const channel of ['sms', 'whatsapp']) {
      for (const screenshots of [undefined, [], ['/uploads/conversation.png', '/uploads/reply.jpg']]) {
        expect(communicationSchema.safeParse({ channel, warrantyWarningGiven: false, screenshots }).success).toBe(true);
      }
    }
    for (const screenshots of [['/uploads/invoice.pdf'], ['https://example.test/image.png'], Array(21).fill('/uploads/image.png')]) {
      expect(communicationSchema.safeParse({ channel: 'sms', warrantyWarningGiven: false, screenshots }).success).toBe(false);
    }
    expect(communicationSchema.safeParse({ channel: 'call', warrantyWarningGiven: false, screenshots: ['/uploads/image.png'] }).success).toBe(false);
    const stored = { format: 'followup-contact-v1', reference: '', communication: { channel: 'whatsapp', warrantyWarningGiven: false, screenshots: ['/uploads/conversation.png'] } };
    expect(decodeCommunicationEvidence(JSON.stringify(stored))).toEqual(stored);
  });
  it('validates channel/result pairing and real-contact installation warning', () => {
    expect(validateCommunication({ channel: 'call', warrantyWarningGiven: false }, 'sms_replied', 'not_installed', 'completed')).toMatch(/canal/);
    expect(validateCommunication({ channel: 'sms', warrantyWarningGiven: false }, 'sms_replied', 'not_installed', 'completed')).toMatch(/garantía/);
    expect(validateCommunication({ channel: 'call', warrantyWarningGiven: true }, 'answered', 'not_installed', 'blocked')).toBeNull();
    expect(validateCommunication({ channel: 'whatsapp', warrantyWarningGiven: false }, 'sms_replied', 'installed_ok', 'completed')).toBeNull();
  });
  it('never invents piece state or warning without response; wrong numbers require a block', () => {
    for (const result of ['sms_sent', 'sms_no_reply', 'no_answer', 'busy']) {
      const channel = result.startsWith('sms') ? 'sms' : 'call';
      expect(validateCommunication({ channel, warrantyWarningGiven: false }, result, null, 'no_response')).toBeNull();
      expect(validateCommunication({ channel, warrantyWarningGiven: false }, result, 'installed_ok', 'no_response')).toMatch(/estado/);
      expect(validateCommunication({ channel, warrantyWarningGiven: false }, result, null, 'completed')).toMatch(/respuesta/);
    }
    expect(validateCommunication({ channel: 'call', warrantyWarningGiven: false }, 'wrong_number', null, 'no_response')).toMatch(/bloqueo/);
    expect(validateCommunication({ channel: 'call', warrantyWarningGiven: false }, 'wrong_number', null, 'blocked')).toBeNull();
  });
  it('provides bilingual templates with actual coverage and safely decodes legacy evidence', () => {
    const terms = { startedAt: '2026-11-01T18:00:00Z', days: 30, policy: 'calendar' as const };
    for (const stage of ['post_3', 'post_7', 'post_14']) for (const language of ['es', 'en'] as const) {
      const text = followupTemplate(stage, language, 'Test customer', 'ORD-TEST', terms);
      expect(text).toContain('30'); expect(text).toContain('ORD-TEST'); expect(text).not.toContain('60');
    }
    expect(communicationSchema.safeParse({ channel: 'email', warrantyWarningGiven: false }).success).toBe(false);
    expect(decodeCommunicationEvidence('Original text')).toBeNull();
    expect(decodeCommunicationEvidence(JSON.stringify({ format: 'followup-contact-v1', reference: 'Client confirmed', communication: { channel: 'sms', warrantyWarningGiven: true } }))).toMatchObject({ reference: 'Client confirmed' });
    expect(decodeCommunicationEvidence('{"format":"followup-contact-v1"}')).toBeNull();
  });
});
