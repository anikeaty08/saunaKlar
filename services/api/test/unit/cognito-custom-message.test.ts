import { describe, expect, it, vi } from 'vitest';
import {
  MAX_EMAIL_MESSAGE,
  brandFromMetadata,
  handleCustomMessage,
  handler,
  type CognitoCustomMessageEvent,
} from '../../src/functions/cognito-custom-message.ts';

const env = { PLATFORM_DOMAIN: 'saunaklar.ch', ADMIN_HOST: 'admin.saunaklar.ch', MAIL_DEFAULT_FROM_NAME: 'Saunaklar' };

const resellerMeta = {
  resellerId: '6f1c2c4e-1f7a-4a8e-9a43-0c8f0d0b9a11',
  brandName: 'Alpha Spa',
  primaryColor: '#2A6F4E',
  supportEmail: 'help@alpha.example.com',
  storefrontUrl: 'https://alpha.saunaklar.ch',
  locale: 'de-CH',
};

/** Shaped like the events Cognito sends (Lambda trigger docs, CustomMessage). */
function event(
  triggerSource: string,
  request: Partial<CognitoCustomMessageEvent['request']> = {},
  pool: 'customers' | 'staff' = 'customers',
): CognitoCustomMessageEvent {
  return {
    version: '1',
    region: 'eu-central-2',
    userPoolId: pool === 'customers' ? 'eu-central-2_Cust0mer5' : 'eu-central-2_Staff0001',
    userName: '0b8a6d0e-55b5-4c4f-9f0e-3d1f0d6c1e22',
    callerContext: { awsSdkVersion: 'aws-sdk-js-3.1156.0', clientId: '1example23456789' },
    triggerSource,
    request: {
      userAttributes: { sub: '0b8a6d0e-55b5-4c4f-9f0e-3d1f0d6c1e22', email: 'anna@example.com', email_verified: 'false', 'cognito:user_status': 'UNCONFIRMED' },
      codeParameter: '{####}',
      linkParameter: '{##Click Here##}',
      usernameParameter: null,
      ...request,
    },
    response: { smsMessage: null, emailMessage: null, emailSubject: null },
  };
}

describe('cognito-custom-message trigger', () => {
  it('CustomMessage_SignUp: branded verification mail in the metadata locale', () => {
    const out = handleCustomMessage(event('CustomMessage_SignUp', { clientMetadata: resellerMeta }), env);
    expect(out.response.emailSubject).toContain('Alpha Spa');
    expect(out.response.emailMessage).toContain('{####}');
    expect(out.response.emailMessage).toContain('lang="de"');
    expect(out.response.emailMessage).toContain('#2a6f4e');
    expect(out.response.emailMessage).toContain('https://alpha.saunaklar.ch');
    expect(out.response.emailMessage).toContain('help@alpha.example.com');
    expect(out.response.emailMessage!.length).toBeLessThanOrEqual(MAX_EMAIL_MESSAGE);
  });

  it('CustomMessage_ResendCode: same verification mail', () => {
    const signUp = handleCustomMessage(event('CustomMessage_SignUp', { clientMetadata: resellerMeta }), env);
    const resend = handleCustomMessage(event('CustomMessage_ResendCode', { clientMetadata: resellerMeta }), env);
    expect(resend.response.emailSubject).toBe(signUp.response.emailSubject);
    expect(resend.response.emailMessage).toContain('{####}');
  });

  it('CustomMessage_ForgotPassword: reset mail, locale falls back to the user attribute', () => {
    const { locale: _ignored, ...noLocale } = resellerMeta;
    const out = handleCustomMessage(
      event('CustomMessage_ForgotPassword', {
        clientMetadata: noLocale,
        userAttributes: { sub: 'x', email: 'anna@example.com', locale: 'fr', given_name: 'Anna', 'cognito:user_status': 'CONFIRMED' },
      }),
      env,
    );
    expect(out.response.emailMessage).toContain('{####}');
    expect(out.response.emailMessage).toContain('lang="fr"');
    expect(out.response.emailMessage).toContain('Anna');
    const signUp = handleCustomMessage(event('CustomMessage_SignUp', { clientMetadata: noLocale }), env);
    expect(out.response.emailSubject).not.toBe(signUp.response.emailSubject);
  });

  it('CustomMessage_AdminCreateUser: staff invitation with username and temporary password placeholders', () => {
    const out = handleCustomMessage(
      event(
        'CustomMessage_AdminCreateUser',
        {
          usernameParameter: '{username}',
          userAttributes: { sub: 'y', email: 'staff@alpha.example.com', name: 'Beat Muster', email_verified: 'true', 'cognito:user_status': 'FORCE_CHANGE_PASSWORD' },
          clientMetadata: { resellerId: resellerMeta.resellerId, brandName: 'Alpha Spa', storefrontUrl: 'https://alpha.saunaklar.ch/admin' },
        },
        'staff',
      ),
      env,
    );
    expect(out.response.emailSubject).toContain('Alpha Spa');
    expect(out.response.emailMessage).toContain('{####}');
    expect(out.response.emailMessage).toContain('{username}');
    expect(out.response.emailMessage).toContain('href="https://alpha.saunaklar.ch/admin"');
    expect(out.response.emailMessage).toContain('Beat Muster');
    expect(out.response.emailMessage).toContain('lang="en"');
  });

  it('CustomMessage_AdminCreateUser without clientMetadata: platform brand linking to the admin host', () => {
    const out = handleCustomMessage(event('CustomMessage_AdminCreateUser', { usernameParameter: '{username}' }, 'staff'), env);
    expect(out.response.emailSubject).toContain('Saunaklar');
    expect(out.response.emailMessage).toContain('href="https://admin.saunaklar.ch/"');
    expect(out.response.emailMessage).toContain('{username}');
  });

  it('CustomMessage_AdminCreateUser without usernameParameter keeps the Cognito default', () => {
    const out = handleCustomMessage(event('CustomMessage_AdminCreateUser', { clientMetadata: resellerMeta }, 'staff'), env);
    expect(out.response.emailMessage).toBeNull();
  });

  it.each(['CustomMessage_UpdateUserAttribute', 'CustomMessage_VerifyUserAttribute'])('%s: verification code mail', (source) => {
    const out = handleCustomMessage(event(source, { clientMetadata: resellerMeta }), env);
    expect(out.response.emailMessage).toContain('{####}');
    expect(out.response.emailSubject).toContain('Alpha Spa');
  });

  it.each(['CustomMessage_Authentication', 'CustomMessage_Unknown'])('%s: event returned unchanged', (source) => {
    const input = event(source, { clientMetadata: resellerMeta });
    const out = handleCustomMessage(structuredClone(input), env);
    expect(out).toEqual(input);
  });

  it('falls back to the platform brand when the storefront URL is not a platform host', () => {
    const out = handleCustomMessage(
      event('CustomMessage_SignUp', { clientMetadata: { ...resellerMeta, brandName: 'Your Bank', storefrontUrl: 'https://evil.example.com' } }),
      env,
    );
    expect(out.response.emailSubject).toContain('Saunaklar');
    expect(out.response.emailSubject).not.toContain('Your Bank');
    expect(out.response.emailMessage).not.toContain('evil.example.com');
    expect(out.response.emailMessage).not.toContain('help@alpha.example.com');
  });

  it('escapes hostile metadata and drops invalid optional fields', () => {
    const out = handleCustomMessage(
      event('CustomMessage_SignUp', {
        clientMetadata: {
          brandName: '<img src=x onerror=alert(1)>\r\nBcc: x@y.z',
          primaryColor: 'red;background:url(javascript:1)',
          supportEmail: 'a@b.c\r\nBcc: x@y.z',
          storefrontUrl: 'https://alpha.saunaklar.ch/?q=<script>#frag',
        },
      }),
      env,
    );
    expect(out.response.emailSubject).not.toMatch(/[\r\n]/);
    expect(out.response.emailMessage).not.toContain('<img');
    expect(out.response.emailMessage).not.toContain('javascript:');
    expect(out.response.emailMessage).not.toContain('<script>');
    expect(out.response.emailMessage).not.toContain('a@b.c'); // supportEmail with CRLF is dropped
    expect(out.response.emailMessage).toContain('{####}');
  });

  it('accepts only https platform URLs', () => {
    const ok = (storefrontUrl: string) => brandFromMetadata({ brandName: 'A', storefrontUrl }, env).branded;
    expect(ok('https://alpha.saunaklar.ch')).toBe(true);
    expect(ok('https://admin.saunaklar.ch/admin')).toBe(true);
    expect(ok('http://alpha.saunaklar.ch')).toBe(false);
    expect(ok('https://alpha.saunaklar.ch.evil.com')).toBe(false);
    expect(ok('https://evilsaunaklar.ch')).toBe(false);
    expect(ok('https://user:pw@alpha.saunaklar.ch')).toBe(false);
    expect(ok('https://alpha.saunaklar.ch:8443')).toBe(false);
    expect(ok('javascript:alert(1)')).toBe(false);
    expect(ok('')).toBe(false);
  });

  it('keeps the Cognito default when rendering would exceed the size limit or lose the code', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = handleCustomMessage(event('CustomMessage_SignUp', { codeParameter: '{####}'.repeat(4000), clientMetadata: resellerMeta }), env);
    expect(out.response.emailMessage).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('handler reads the environment', async () => {
    vi.stubEnv('PLATFORM_DOMAIN', 'saunaklar.ch');
    vi.stubEnv('ADMIN_HOST', 'admin.saunaklar.ch');
    vi.stubEnv('MAIL_DEFAULT_FROM_NAME', 'Saunaklar Test');
    try {
      const out = await handler(event('CustomMessage_ForgotPassword'));
      expect(out.response.emailSubject).toContain('Saunaklar Test');
      expect(out.response.emailMessage).toContain('{####}');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
