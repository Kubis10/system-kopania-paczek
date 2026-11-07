import nodemailer, { Transporter } from 'nodemailer';
import { Status } from './domain';

const statusLabels: Record<Status, string> = {
  CREATED: 'Przyjęta do nadania',
  IN_TRANSIT: 'W drodze',
  OUT_FOR_DELIVERY: 'W doręczeniu',
  DELIVERED: 'Doręczona',
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export class Notifications {
  private readonly transport?: Transporter;
  private readonly sender?: string;
  private verification?: Promise<boolean>;
  private verifiedState?: boolean;

  constructor() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const password = process.env.SMTP_PASSWORD;
    this.sender = process.env.SMTP_FROM;
    if (!host || !user || !password || !this.sender) return;
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    this.transport = nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS: !secure,
      auth: { user, pass: password },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  get configured() { return Boolean(this.transport && this.sender); }

  async verify(): Promise<boolean> {
    if (!this.transport || !this.sender) return false;
    this.verification ??= this.transport.verify().then(() => {
      this.verifiedState = true;
      return true;
    }).catch(error => {
      this.verifiedState = false;
      console.error('SMTP verification failed:', { code: error.code, responseCode: error.responseCode });
      return false;
    });
    return this.verification;
  }

  async parcelCreated(input: { email: string; name: string; trackingNumber: string; pin: string; estimatedDelivery: string }) {
    const name = escapeHtml(input.name);
    const number = escapeHtml(input.trackingNumber);
    const pin = escapeHtml(input.pin);
    const delivery = escapeHtml(new Date(input.estimatedDelivery).toLocaleDateString('pl-PL'));
    await this.send(input.email, `Przesyłka ${input.trackingNumber} została nadana`,
      `Dzień dobry ${input.name}, przesyłka ${input.trackingNumber} jest gotowa do nadania. Kod odbioru: ${input.pin}. Przewidywane doręczenie: ${delivery}.`,
      `<p>Dzień dobry ${name},</p><p>Przesyłka <strong>${number}</strong> jest gotowa do nadania.</p><p>Kod odbioru: <strong>${pin}</strong></p><p>Przewidywane doręczenie: ${delivery}</p>`);
  }

  async statusChanged(input: { email: string; name: string; trackingNumber: string; status: Status }) {
    const name = escapeHtml(input.name);
    const number = escapeHtml(input.trackingNumber);
    const status = statusLabels[input.status];
    await this.send(input.email, `Aktualizacja przesyłki ${input.trackingNumber}`,
      `Dzień dobry ${input.name}, status przesyłki ${input.trackingNumber} zmienił się na: ${status}.`,
      `<p>Dzień dobry ${name},</p><p>Status przesyłki <strong>${number}</strong> zmienił się na:</p><p><strong>${status}</strong></p>`);
  }

  private async send(to: string, subject: string, text: string, html: string) {
    if (!this.transport || !this.sender) throw new Error('SMTP is not configured');
    try {
      await this.transport.sendMail({ from: this.sender, to, subject, text, html });
      this.verifiedState = true;
    } catch (error) {
      this.verifiedState = false;
      this.verification = undefined;
      throw error;
    }
  }
}