import { Injectable } from '@nestjs/common';
import { encode } from 'html-entities';

@Injectable()
export class TemplateService {
  renderOtpTemplate(input: {
    name?: string;
    otpCode: string;
    expiresInMinutes: number;
    appName: string;
  }) {
    const greeting = input.name ? `Hi ${this.escapeHtml(input.name)},` : 'Hi,';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #111827;">
        <h2 style="margin-bottom: 16px;">${this.escapeHtml(input.appName)} verification code</h2>
        <p>${greeting}</p>
        <p>Your one-time verification code is:</p>
        <div style="font-size: 32px; letter-spacing: 8px; font-weight: 700; margin: 24px 0;">
          ${this.escapeHtml(input.otpCode)}
        </div>
        <p>This code expires in ${input.expiresInMinutes} minutes.</p>
        <p>If you did not request this code, you can ignore this email.</p>
      </div>
    `.trim();

    const text = [
      `${input.appName} verification code`,
      '',
      input.name ? `Hi ${input.name},` : 'Hi,',
      '',
      `Your OTP is: ${input.otpCode}`,
      `It expires in ${input.expiresInMinutes} minutes.`,
      '',
      'If you did not request this code, ignore this email.',
    ].join('\n');

    return { html, text };
  }

  renderWelcomeTemplate(input: {
    name?: string;
    appName: string;
    loginUrl: string;
  }) {
    const greeting = input.name ? `Hi ${this.escapeHtml(input.name)},` : 'Hi,';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #111827;">
        <h2>Welcome to ${this.escapeHtml(input.appName)}</h2>
        <p>${greeting}</p>
        <p>Your account is ready.</p>
        <p>
          <a href="${this.escapeHtml(input.loginUrl)}"
             style="display:inline-block;padding:12px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;">
             Open dashboard
          </a>
        </p>
      </div>
    `.trim();

    const text = [
      `Welcome to ${input.appName}`,
      '',
      input.name ? `Hi ${input.name},` : 'Hi,',
      '',
      `Open dashboard: ${input.loginUrl}`,
    ].join('\n');

    return { html, text };
  }

  renderCampaignTemplate(
    template: string,
    vars: Record<string, string | undefined>,
    options: { escapeHtml?: boolean } = {},
  ): string {
    const escapeHtml = options.escapeHtml ?? true;

    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const value = vars[key] ?? '';

      return escapeHtml ? this.escapeHtml(value) : value;
    });
  }

  private escapeHtml(value: string): string {
    return encode(value, { level: 'html5', mode: 'specialChars' });
  }
}
