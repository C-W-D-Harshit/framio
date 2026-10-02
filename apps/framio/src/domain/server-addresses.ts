import type { ServerUrl } from "../contracts/server-info";

export const defaultHost = "0.0.0.0";
export const httpUrl = (host: string, port: number) =>
  `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
export const serverBaseUrl = (host: string, port: number) =>
  httpUrl(host === "0.0.0.0" || host === "::" ? "localhost" : host, port);

export type NetworkAddress = {
  name: string;
  address: string;
  internal: boolean;
};
export type TailscaleAddress = {
  ips: readonly string[];
  dnsName?: string;
};

export function serverUrls(
  host: string,
  port: number,
  interfaces: readonly NetworkAddress[],
  tailscale: TailscaleAddress | null,
): ServerUrl[] {
  const wildcard = host === "0.0.0.0" || host === "::";
  const loopback =
    host === "localhost" || host === "::1" || host.startsWith("127.");
  const supports = (ip: string) => host !== "0.0.0.0" || !ip.includes(":");
  const tailIPs =
    tailscale?.ips.filter((ip) => (wildcard ? supports(ip) : ip === host)) ??
    [];
  const urls: ServerUrl[] = [];
  const add = (kind: ServerUrl["kind"], address: string) => {
    const url = httpUrl(address, port);
    if (!urls.some((entry) => entry.url === url)) urls.push({ kind, url });
  };
  if (wildcard || loopback) add("local", wildcard ? "localhost" : host);
  else if (!tailIPs.includes(host)) add("network", host);
  if (wildcard) {
    for (const entry of interfaces) {
      if (
        entry.internal ||
        !supports(entry.address) ||
        /^(docker\d*|br-|veth|virbr|vmnet|vboxnet|bridge\d*)/i.test(
          entry.name,
        ) ||
        /^(127\.|169\.254\.|0\.|fe[89ab]|ff|::)/i.test(entry.address) ||
        tailIPs.includes(entry.address)
      )
        continue;
      add("network", entry.address);
    }
  }
  if (tailIPs.length) {
    if (tailscale?.dnsName) add("tailscale", tailscale.dnsName);
    for (const ip of tailIPs) add("tailscale", ip);
  }
  return urls;
}
