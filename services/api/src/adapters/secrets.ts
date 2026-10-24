import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

/**
 * Reads a plain-string secret (e.g. the CloudFront signing PEM) from Secrets Manager. Callers
 * cache the result for the lifetime of the Lambda container.
 */
export async function loadSecretString(secretId: string, options: { region?: string; client?: SecretsManagerClient } = {}): Promise<string> {
  const client = options.client ?? new SecretsManagerClient(options.region ? { region: options.region } : {});
  const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const value = out.SecretString ?? (out.SecretBinary ? Buffer.from(out.SecretBinary).toString('utf8') : '');
  if (!value.trim()) throw new Error('Secret is empty');
  return value;
}
