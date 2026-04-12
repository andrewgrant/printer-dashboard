// Ambient type shims for JS-only dependencies we use.

declare module 'net-snmp' {
  export const Version2c: number;
  export function createSession(target: string, community: string, options?: {
    version?: number;
    timeout?: number;
    retries?: number;
    port?: number;
  }): Session;
  export function isVarbindError(vb: Varbind): boolean;
  export function varbindError(vb: Varbind): string;

  export interface Varbind {
    oid: string;
    type: number;
    value: unknown;
  }

  export interface Session {
    get(
      oids: string[],
      cb: (err: Error | null, varbinds: Varbind[]) => void,
    ): void;
    subtree(
      oid: string,
      maxRepetitions: number,
      feedCb: (varbinds: Varbind[]) => void,
      doneCb: (err: Error | null) => void,
    ): void;
    close(): void;
    on(event: 'error', listener: (err: Error) => void): this;
    off(event: 'error', listener: (err: Error) => void): this;
  }

  const snmp: {
    Version2c: number;
    createSession: typeof createSession;
    isVarbindError: typeof isVarbindError;
    varbindError: typeof varbindError;
  };
  export default snmp;
}
