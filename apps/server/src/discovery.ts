import { Bonjour, type Service } from 'bonjour-service';

export interface DiscoveredPrinter {
  ip: string;
  name: string;
  host?: string;
  model?: string;
  sources: Array<'ipp' | 'printer' | 'pdl-datastream'>;
}

const SERVICE_TYPES = ['ipp', 'printer', 'pdl-datastream'] as const;
type ServiceType = (typeof SERVICE_TYPES)[number];

function ipv4Addresses(service: Service): string[] {
  return (service.addresses ?? []).filter((a) => !a.includes(':'));
}

function modelFromTxt(txt: Record<string, unknown> | undefined): string | undefined {
  if (!txt) return undefined;
  const ty = txt.ty;
  const product = txt.product;
  if (typeof ty === 'string' && ty.length > 0) return ty;
  if (typeof product === 'string' && product.length > 0) {
    return product.replace(/^\(|\)$/g, '');
  }
  return undefined;
}

/**
 * Browse mDNS for `windowMs` milliseconds and return one entry per IP,
 * merging services advertised across _ipp / _printer / _pdl-datastream.
 */
export async function discover(windowMs = 8000): Promise<DiscoveredPrinter[]> {
  const bonjour = new Bonjour();
  const byIp = new Map<string, DiscoveredPrinter>();

  const browsers = SERVICE_TYPES.map((type) => {
    const browser = bonjour.find({ type });
    browser.on('up', (service: Service) => {
      for (const ip of ipv4Addresses(service)) {
        const existing = byIp.get(ip);
        if (existing) {
          if (!existing.sources.includes(type)) existing.sources.push(type);
          if (!existing.model) existing.model = modelFromTxt(service.txt);
          continue;
        }
        byIp.set(ip, {
          ip,
          name: service.name,
          host: service.host,
          model: modelFromTxt(service.txt),
          sources: [type],
        });
      }
    });
    return browser;
  });

  await new Promise((resolve) => setTimeout(resolve, windowMs));
  for (const b of browsers) b.stop();
  bonjour.destroy();

  return [...byIp.values()];
}

/** Classify a service type as "definitely a printer" for filtering. */
export function isPrinterService(type: string): type is ServiceType {
  return (SERVICE_TYPES as readonly string[]).includes(type);
}
