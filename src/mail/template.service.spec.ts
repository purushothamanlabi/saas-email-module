import { TemplateService } from './template.service';

describe('TemplateService', () => {
  let service: TemplateService;

  beforeEach(() => {
    service = new TemplateService();
  });

  it('escapes campaign variables inserted into HTML by default', () => {
    const html = service.renderCampaignTemplate('<p>{{name}}</p>', {
      name: '<b>Asha & "Bala"</b>',
    });

    expect(html).toBe('<p>&lt;b&gt;Asha &amp; &quot;Bala&quot;&lt;/b&gt;</p>');
  });

  it('leaves campaign variables unescaped when escapeHtml is false', () => {
    const subject = service.renderCampaignTemplate(
      'Hello {{name}}',
      {
        name: '<Asha>',
      },
      { escapeHtml: false },
    );

    expect(subject).toBe('Hello <Asha>');
  });

  it('escapes OTP HTML template values', () => {
    const { html } = service.renderOtpTemplate({
      name: '<Asha & Bala>',
      otpCode: '12<34>',
      expiresInMinutes: 10,
      appName: 'Mail & App',
    });

    expect(html).toContain('Hi &lt;Asha &amp; Bala&gt;,');
    expect(html).toContain('Mail &amp; App verification code');
    expect(html).toContain('12&lt;34&gt;');
  });

  it('escapes welcome HTML template values', () => {
    const { html } = service.renderWelcomeTemplate({
      name: 'Asha "Admin"',
      appName: 'Mail <App>',
      loginUrl: 'https://example.com/login?next=<dashboard>&user="1"',
    });

    expect(html).toContain('Hi Asha &quot;Admin&quot;,');
    expect(html).toContain('Welcome to Mail &lt;App&gt;');
    expect(html).toContain(
      'https://example.com/login?next=&lt;dashboard&gt;&amp;user=&quot;1&quot;',
    );
  });
});
