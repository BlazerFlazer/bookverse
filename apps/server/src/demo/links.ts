import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';
import { config } from '../config.ts';

const VIRTUAL_ADAPTER = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|Tailscale|ZeroTier/i;

/** Адрес этого компьютера в локальной сети: по нему откроются телефоны зрителей. */
export function lanAddress(): string | null {
  const found: string[] = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_ADAPTER.test(name)) continue;
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) found.push(address.address);
    }
  }
  return found.find((ip) => ip.startsWith('192.168.')) ?? found.find((ip) => ip.startsWith('10.')) ?? found[0] ?? null;
}

const isLocalUrl = (url: string) => /\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(url);

/**
 * Куда вести зрителей. С localhost на телефоне ничего не откроется, поэтому берём адрес
 * компьютера в сети, а порт из того сайта, на котором работает ведущий.
 */
export function publicBaseUrl(requestOrigin: string | undefined): string {
  if (config.DEMO_PUBLIC_URL) return config.DEMO_PUBLIC_URL.replace(/\/$/, '');
  if (!isLocalUrl(config.PUBLIC_WEB_URL)) return config.PUBLIC_WEB_URL.replace(/\/$/, '');
  const origin = requestOrigin ?? config.PUBLIC_WEB_URL;
  const lan = lanAddress();
  if (!lan) return origin.replace(/\/$/, '');
  const url = new URL(origin);
  return `${url.protocol}//${lan}${url.port ? `:${url.port}` : ''}`;
}

export function joinLinks(code: string, requestOrigin: string | undefined) {
  const bot = config.TELEGRAM_BOT_USERNAME;
  return {
    web: `${publicBaseUrl(requestOrigin)}/join/${code}`,
    telegram: bot ? `https://t.me/${bot}?start=demo_${code}` : null,
  };
}

export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    color: { dark: '#1c120bff', light: '#fff8ebff' },
  });
}
