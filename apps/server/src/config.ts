import { z } from 'zod';

const Schema = z.object({
  SNMP_COMMUNITY: z.string().default('public'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Config = z.infer<typeof Schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Schema.parse(env);
}
