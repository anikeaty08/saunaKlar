import { describe, expect, it } from 'vitest';
import type { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { SESv2Client } from '@aws-sdk/client-sesv2';
import type { CloudFrontKeyValueStoreClient } from '@aws-sdk/client-cloudfront-keyvaluestore';
import { ConflictException } from '@aws-sdk/client-cloudfront-keyvaluestore';
import { CognitoIdentityProvider } from '../../../src/adapters/idp/cognito.ts';
import { cognitoErrorCode } from '../../../src/adapters/idp/cognito-errors.ts';
import { SesMailer } from '../../../src/adapters/mail/ses.ts';
import { KeyValueStoreEdgeTenantStore } from '../../../src/adapters/edge/kvs.ts';
import { IdpError } from '../../../src/adapters/errors.ts';

type Sent = { name: string; input: Record<string, any> };

/** A stand-in SDK client: records commands and answers from a per-command script. */
function fakeClient(answers: Record<string, (input: any) => unknown>) {
  const sent: Sent[] = [];
  const client = {
    async send(command: { constructor: { name: string }; input: Record<string, any> }) {
      const name = command.constructor.name.replace(/Command$/, '');
      sent.push({ name, input: command.input });
      const answer = answers[name];
      if (!answer) throw new Error(`unexpected ${name}`);
      return answer(command.input);
    },
  };
  return { client, sent };
}

const err = (name: string, message = name) => Object.assign(new Error(message), { name });
const pools = {
  CUSTOMER: { userPoolId: 'eu-central-1_cust', clientId: 'custclient' },
  STAFF: { userPoolId: 'eu-central-1_staff', clientId: 'staffclient' },
};
const meta = { brandName: 'Alpha Spa', storefrontUrl: 'https://alpha.example.com', locale: 'de', resellerId: 'r1' };

describe('cognitoErrorCode', () => {
  it.each([
    ['InvalidPasswordException', 'signup', 'PASSWORD_POLICY'],
    ['UsernameExistsException', 'signup', 'CONFLICT'],
    ['UserNotConfirmedException', 'auth', 'EMAIL_NOT_VERIFIED'],
    ['UserNotFoundException', 'auth', 'INVALID_CREDENTIALS'],
    ['UserNotFoundException', 'code', 'CODE_INVALID'],
    ['CodeMismatchException', 'code', 'CODE_INVALID'],
    ['CodeMismatchException', 'mfa', 'MFA_INVALID'],
    ['ExpiredCodeException', 'code', 'CODE_EXPIRED'],
    ['ExpiredCodeException', 'mfa', 'CHALLENGE_EXPIRED'],
    ['TooManyRequestsException', 'auth', 'RATE_LIMITED'],
    ['NotAuthorizedException', 'auth', 'INVALID_CREDENTIALS'],
    ['NotAuthorizedException', 'refresh', 'SESSION_EXPIRED'],
  ] as const)('%s in %s → %s', (name, ctx, code) => {
    expect(cognitoErrorCode(err(name), ctx)).toBe(code);
  });

  it('recognises disabled users and expired sessions by message', () => {
    expect(cognitoErrorCode(err('NotAuthorizedException', 'User is disabled.'), 'auth')).toBe('ACCOUNT_DISABLED');
    expect(cognitoErrorCode(err('NotAuthorizedException', 'Invalid session for the user, session is expired.'), 'mfa')).toBe('CHALLENGE_EXPIRED');
    expect(cognitoErrorCode(err('InternalErrorException'), 'auth')).toBeNull();
  });
});

describe('CognitoIdentityProvider', () => {
  const make = (answers: Record<string, (input: any) => unknown>) => {
    const { client, sent } = fakeClient(answers);
    return { idp: new CognitoIdentityProvider({ pools, client: client as unknown as CognitoIdentityProviderClient }), sent };
  };

  it('signs up against the pool client with branding metadata', async () => {
    const { idp, sent } = make({ SignUp: () => ({ UserSub: 'sub-1' }) });
    await expect(
      idp.signUp({ pool: 'CUSTOMER', username: 'u1', email: 'a@b.ch', password: 'Sauna-Lover-2026', attributes: { given_name: 'Anna' }, clientMetadata: meta }),
    ).resolves.toEqual({ sub: 'sub-1' });
    expect(sent[0]!.input).toMatchObject({ ClientId: 'custclient', Username: 'u1', ClientMetadata: meta });
    expect(sent[0]!.input.UserAttributes).toEqual([
      { Name: 'given_name', Value: 'Anna' },
      { Name: 'email', Value: 'a@b.ch' },
    ]);
  });

  it('maps InitiateAuth failures without revealing users', async () => {
    const { idp } = make({ InitiateAuth: () => Promise.reject(err('UserNotFoundException')) });
    await expect(idp.initiateAuth('CUSTOMER', 'x', 'y')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('carries USERNAME through challenge sessions (MFA setup round trip)', async () => {
    const { idp, sent } = make({
      InitiateAuth: () => ({ ChallengeName: 'MFA_SETUP', Session: 'S1' }),
      AssociateSoftwareToken: () => ({ SecretCode: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', Session: 'S2' }),
      VerifySoftwareToken: () => ({ Status: 'SUCCESS', Session: 'S3' }),
      RespondToAuthChallenge: () => ({ AuthenticationResult: { AccessToken: 'a', RefreshToken: 'r', ExpiresIn: 3600 } }),
    });
    const start = await idp.initiateAuth('STAFF', 'owner@alpha.ch', 'pw');
    if (start.kind !== 'CHALLENGE') throw new Error('expected challenge');
    expect(start.challenge).toBe('MFA_SETUP');
    const assoc = await idp.associateSoftwareToken('STAFF', start.session);
    expect(assoc.otpauthUri).toContain('secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    const tokens = await idp.verifySoftwareToken('STAFF', assoc.session, '123456');
    expect(tokens).toEqual({ accessToken: 'a', refreshToken: 'r', expiresIn: 3600 });
    expect(sent.map((s) => s.name)).toEqual(['InitiateAuth', 'AssociateSoftwareToken', 'VerifySoftwareToken', 'RespondToAuthChallenge']);
    expect(sent[1]!.input).toEqual({ Session: 'S1' });
    expect(sent[2]!.input).toEqual({ Session: 'S2', UserCode: '123456' });
    expect(sent[3]!.input).toMatchObject({ ClientId: 'staffclient', ChallengeName: 'MFA_SETUP', Session: 'S3', ChallengeResponses: { USERNAME: 'owner@alpha.ch' } });
  });

  it('rejects garbage sessions before calling Cognito', async () => {
    const { idp, sent } = make({});
    await expect(idp.respondMfa('STAFF', 'garbage', '123456')).rejects.toMatchObject({ code: 'CHALLENGE_EXPIRED' });
    expect(sent).toHaveLength(0);
  });

  it('keeps the refresh token when Cognito does not rotate it', async () => {
    const { idp } = make({ InitiateAuth: () => ({ AuthenticationResult: { AccessToken: 'a2', ExpiresIn: 3600 } }) });
    await expect(idp.refresh('CUSTOMER', 'r1')).resolves.toEqual({ accessToken: 'a2', refreshToken: 'r1', expiresIn: 3600 });
  });

  it('forgotPassword is silent for unknown users and suppresses invites without branding', async () => {
    const { idp, sent } = make({
      ForgotPassword: () => Promise.reject(err('UserNotFoundException')),
      AdminCreateUser: () => ({ User: { Attributes: [{ Name: 'sub', Value: 'staff-sub' }] } }),
    });
    await expect(idp.forgotPassword('CUSTOMER', 'nobody', meta)).resolves.toBeUndefined();
    const created = await idp.adminCreateUser('STAFF', { username: 'x@y.ch', email: 'x@y.ch' });
    expect(created.sub).toBe('staff-sub');
    expect(sent[1]!.input).toMatchObject({ UserPoolId: 'eu-central-1_staff', MessageAction: 'SUPPRESS', TemporaryPassword: created.temporaryPassword });
  });

  it('maps invalid access tokens to SESSION_EXPIRED', async () => {
    const { idp } = make({});
    const e = await idp.verifyAccessToken('CUSTOMER', 'not.a.jwt').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(IdpError);
    expect((e as IdpError).code).toBe('SESSION_EXPIRED');
  });
});

describe('SesMailer', () => {
  it('always sends from the platform domain with the reseller as Reply-To', async () => {
    const { client, sent } = fakeClient({ SendEmail: () => ({ MessageId: 'm-1' }) });
    const mailer = new SesMailer({ fromDomain: 'mail.saunaklar.example', defaultFromName: 'Saunaklar', configurationSet: 'tx', client: client as unknown as SESv2Client });
    await expect(
      mailer.send({ to: 'anna@example.com', subject: 'Hi\r\nBcc: x', html: '<p>x</p>', text: 'x', fromName: 'Alpha Spa', replyTo: 'help@alpha.ch', resellerId: '0b9a0f7e-1111-4222-8333-944455556666' }),
    ).resolves.toEqual({ messageId: 'm-1' });
    expect(sent[0]!.input).toMatchObject({
      FromEmailAddress: '"Alpha Spa" <no-reply@mail.saunaklar.example>',
      Destination: { ToAddresses: ['anna@example.com'] },
      ReplyToAddresses: ['help@alpha.ch'],
      ConfigurationSetName: 'tx',
      EmailTags: [{ Name: 'reseller', Value: '0b9a0f7e-1111-4222-8333-944455556666' }],
    });
    expect(sent[0]!.input.Content.Simple.Subject.Data).toBe('Hi Bcc: x');
  });

  it('refuses malformed recipients', async () => {
    const { client } = fakeClient({});
    const mailer = new SesMailer({ fromDomain: 'm.ch', defaultFromName: 'S', client: client as unknown as SESv2Client });
    await expect(mailer.send({ to: 'a@b.ch>, c@d.ch', subject: 's', html: 'h', text: 't' })).rejects.toThrow();
  });
});

describe('KeyValueStoreEdgeTenantStore', () => {
  it('writes with the current ETag and retries on conflicts', async () => {
    let puts = 0;
    const { client, sent } = fakeClient({
      DescribeKeyValueStore: () => ({ ETag: `etag-${sent.length}` }),
      PutKey: () => {
        puts++;
        if (puts === 1) throw new ConflictException({ message: 'conflict', $metadata: {} });
        return {};
      },
    });
    const kvs = new KeyValueStoreEdgeTenantStore('arn:aws:cloudfront::1:key-value-store/x', { client: client as unknown as CloudFrontKeyValueStoreClient });
    await kvs.put('alpha-spa', 'SUSPENDED');
    expect(sent.map((s) => s.name)).toEqual(['DescribeKeyValueStore', 'PutKey', 'DescribeKeyValueStore', 'PutKey']);
    expect(sent[3]!.input).toMatchObject({ Key: 'alpha-spa', Value: 'SUSPENDED', IfMatch: 'etag-3' });
    await expect(kvs.put('Not A Slug', 'ACTIVE')).rejects.toThrow('Invalid tenant slug');
  });
});
