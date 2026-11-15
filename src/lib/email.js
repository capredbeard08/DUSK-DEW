/**
 * Customer communication. Templates are editable in the Founder Console.
 * Sending requires a configured provider (Resend) and a founder-verified
 * sending address — neither is invented or hardcoded here.
 */
import { all, nowIso, one, run, uid } from './db.js';
import { escapeHtml } from './security.js';

export const DEFAULT_TEMPLATES = [
  {
    key: 'waitlist_confirmation',
    name: 'Waitlist confirmation',
    subject: 'You are on the DUSK & DEW list',
    body: `Hello {{name}},\n\nThank you for registering your interest in {{product}}.\nWe will write to you as soon as there is news about availability.\n\nDUSK & DEW — Skin, from first dew to last light.`,
  },
  {
    key: 'account_registration',
    name: 'Account registration',
    subject: 'Your DUSK & DEW account',
    body: `Hello {{name}},\n\nYour account is ready. You can review your orders at any time.\n\nDUSK & DEW`,
  },
  {
    key: 'order_confirmation',
    name: 'Order confirmation',
    subject: 'Order {{reference}} received',
    body: `Hello {{name}},\n\nThank you for your order {{reference}}.\nTotal: {{total}}\n\nWe will confirm again once payment has been verified.`,
  },
  {
    key: 'payment_confirmation',
    name: 'Payment confirmation',
    subject: 'Payment received for {{reference}}',
    body: `Hello {{name}},\n\nPayment for order {{reference}} has been verified.\nTotal: {{total}}\n\nThank you.`,
  },
  {
    key: 'production_update',
    name: 'Production update',
    subject: 'Production update for {{reference}}',
    body: `Hello {{name}},\n\nAn update on your preorder {{reference}}: {{message}}\n\nWe will keep you informed of any change to the estimated dispatch date.`,
  },
  {
    key: 'restock_alert',
    name: 'Restock alert',
    subject: '{{product}} is available again',
    body: `Hello {{name}},\n\n{{product}} is available again.\n\nDUSK & DEW`,
  },
  {
    key: 'dispatch_notification',
    name: 'Dispatch notification',
    subject: 'Order {{reference}} has been dispatched',
    body: `Hello {{name}},\n\nYour order {{reference}} has left our studio.\nCarrier: {{carrier}}\nTracking: {{tracking}}`,
  },
  {
    key: 'tracking_information',
    name: 'Tracking information',
    subject: 'Tracking for order {{reference}}',
    body: `Hello {{name}},\n\nTracking for {{reference}}: {{tracking}} ({{carrier}}).`,
  },
  {
    key: 'cancellation',
    name: 'Cancellation',
    subject: 'Order {{reference}} cancelled',
    body: `Hello {{name}},\n\nOrder {{reference}} has been cancelled. Any captured payment will be refunded in full.`,
  },
  {
    key: 'refund_confirmation',
    name: 'Refund confirmation',
    subject: 'Refund issued for {{reference}}',
    body: `Hello {{name}},\n\nA refund of {{amount}} has been issued for order {{reference}}.\nBank processing times vary; your provider will confirm when funds arrive.`,
  },
];

export function renderTemplate(template, data) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

export function money(cents, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((Number(cents) || 0) / 100);
  } catch {
    return `${((Number(cents) || 0) / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * Record a customer email in the outbox. If a provider is configured and the
 * template is enabled the message is delivered; otherwise it is kept as
 * "skipped" so the founder can see exactly what would have been sent.
 */
export async function queueEmail(db, { to, templateKey, data = {}, orderId = null }) {
  const template = await one(db, 'SELECT * FROM email_templates WHERE key = ?', templateKey);
  if (!template || !template.enabled) {
    return { queued: false, reason: 'template_disabled' };
  }
  const subject = renderTemplate(template.subject, data);
  const body = renderTemplate(template.body, data);
  const id = uid('eml_');
  await run(
    db,
    `INSERT INTO email_notifications (id, to_email, template_key, subject, body, status, order_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
    id,
    to,
    templateKey,
    subject,
    body,
    orderId,
    nowIso(),
  );
  return { queued: true, id };
}

export async function deliverQueuedEmails(db, env) {
  const from = env.EMAIL_FROM;
  if (!env.RESEND_API_KEY || !from) {
    await run(
      db,
      `UPDATE email_notifications SET status = 'skipped', detail = 'Email provider not configured (set RESEND_API_KEY and EMAIL_FROM, then verify the sending domain).'
       WHERE status = 'queued'`,
    );
    return { sent: 0, skipped: true };
  }
  const pending = await all(db, `SELECT * FROM email_notifications WHERE status = 'queued' ORDER BY created_at LIMIT 25`);
  let sent = 0;
  for (const mail of pending) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [mail.to_email],
          subject: mail.subject,
          text: mail.body,
          html: `<div style="font-family:Georgia,serif;line-height:1.6">${escapeHtml(mail.body).replace(/\n/g, '<br>')}</div>`,
        }),
      });
      if (res.ok) {
        await run(db, `UPDATE email_notifications SET status = 'sent', sent_at = ? WHERE id = ?`, nowIso(), mail.id);
        sent += 1;
      } else {
        await run(db, `UPDATE email_notifications SET status = 'failed', detail = ? WHERE id = ?`, `Provider responded ${res.status}`, mail.id);
      }
    } catch (err) {
      await run(db, `UPDATE email_notifications SET status = 'failed', detail = ? WHERE id = ?`, String(err).slice(0, 200), mail.id);
    }
  }
  return { sent, skipped: false };
}
