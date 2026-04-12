import { z } from 'zod';

const Schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  POLL_INTERVAL_SEC: z.coerce.number().int().positive().default(60),
  DISCOVERY_INTERVAL_SEC: z.coerce.number().int().positive().default(300),
  SNMP_COMMUNITY: z.string().default('public'),
  SNMP_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  DATA_DIR: z.string().default('./data'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Config = z.infer<typeof Schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Schema.parse(env);
}
