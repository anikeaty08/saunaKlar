import { loadSecretString } from '../adapters/secrets.ts';

/**
 * In AWS the secrets arrive as Secrets Manager ARNs (`APP_SECRET_ARN`,
 * `ORIGIN_SECRET_ARN`) rather than values, so they never appear in the
 * Lambda configuration. This resolves them once per execution environment
 * into the plain variables `loadConfig` reads. A value already set wins.
 */
const SECRET_VARS = ['APP_SECRET', 'ORIGIN_SECRET'] as const;

export async function resolveSecretEnv(env: Record<string, string | undefined> = process.env): Promise<Record<string, string | undefined>> {
  const out = { ...env };
  await Promise.all(SECRET_VARS.map(async name => {
    const arn = env[`${name}_ARN`];
    if (!out[name] && arn) out[name] = await loadSecretString(arn, env.AWS_REGION ? { region: env.AWS_REGION } : {});
  }));
  return out;
}
