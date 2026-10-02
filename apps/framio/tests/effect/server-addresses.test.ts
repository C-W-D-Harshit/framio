import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { serverBaseUrl, serverUrls } from "../../src/domain/server-addresses";
import { canOpenBrowser } from "../../src/platform/network-addresses";
import { parseTailscale } from "../../src/services/server-addresses";

describe("server addresses", () => {
  it("lists usable addresses once and labels Tailscale from authoritative status", () => {
    const urls = serverUrls(
      "0.0.0.0",
      4747,
      [
        { name: "lo0", address: "127.0.0.1", internal: true },
        { name: "en0", address: "192.168.1.42", internal: false },
        { name: "en1", address: "192.168.1.42", internal: false },
        { name: "tailscale0", address: "100.64.0.2", internal: false },
        { name: "docker0", address: "172.17.0.1", internal: false },
        { name: "en0", address: "169.254.1.2", internal: false },
        { name: "en0", address: "fe80::1", internal: false },
        { name: "en0", address: "2001:db8::2", internal: false },
      ],
      {
        ips: ["100.64.0.2", "fd7a:115c:a1e0::2"],
        dnsName: "vm.example.ts.net",
      },
    );
    assert.deepStrictEqual(urls, [
      { kind: "local", url: "http://localhost:4747" },
      { kind: "network", url: "http://192.168.1.42:4747" },
      { kind: "tailscale", url: "http://vm.example.ts.net:4747" },
      { kind: "tailscale", url: "http://100.64.0.2:4747" },
    ]);
  });

  it("local-only bindings advertise no remote addresses", () => {
    for (const host of ["localhost", "127.0.0.1", "::1"])
      assert.deepStrictEqual(
        serverUrls(
          host,
          4800,
          [{ name: "en0", address: "192.168.1.42", internal: false }],
          { ips: ["100.64.0.2"] },
        ),
        [{ kind: "local", url: serverBaseUrl(host, 4800) }],
      );
  });

  it("specific interfaces advertise only their bound address", () => {
    assert.deepStrictEqual(
      serverUrls("192.168.1.42", 4800, [], { ips: ["100.64.0.2"] }),
      [{ kind: "network", url: "http://192.168.1.42:4800" }],
    );
    assert.deepStrictEqual(
      serverUrls("100.64.0.2", 4800, [], {
        ips: ["100.64.0.2"],
        dnsName: "vm.example.ts.net",
      }),
      [
        { kind: "tailscale", url: "http://vm.example.ts.net:4800" },
        { kind: "tailscale", url: "http://100.64.0.2:4800" },
      ],
    );
  });

  it("IPv6 URLs use brackets and exclude link-local addresses", () => {
    assert.deepStrictEqual(
      serverUrls(
        "::",
        4800,
        [
          { name: "en0", address: "2001:db8::2", internal: false },
          { name: "en0", address: "fe80::2", internal: false },
        ],
        { ips: ["fd7a:115c:a1e0::2"] },
      ),
      [
        { kind: "local", url: "http://localhost:4800" },
        { kind: "network", url: "http://[2001:db8::2]:4800" },
        { kind: "tailscale", url: "http://[fd7a:115c:a1e0::2]:4800" },
      ],
    );
  });

  it("does not assume every CGNAT address belongs to Tailscale", () => {
    assert.deepStrictEqual(
      serverUrls(
        "0.0.0.0",
        4747,
        [{ name: "wwan0", address: "100.64.0.3", internal: false }],
        null,
      ),
      [
        { kind: "local", url: "http://localhost:4747" },
        { kind: "network", url: "http://100.64.0.3:4747" },
      ],
    );
  });

  it.effect("uses only the running local node and enabled MagicDNS", () =>
    Effect.gen(function* () {
      const status = {
        BackendState: "Running",
        Self: { TailscaleIPs: ["100.64.0.2"], DNSName: "vm.example.ts.net." },
        CurrentTailnet: { MagicDNSEnabled: true },
        Peer: { other: { TailscaleIPs: ["100.64.0.99"] } },
      };
      assert.deepStrictEqual(yield* parseTailscale(JSON.stringify(status)), {
        ips: ["100.64.0.2"],
        dnsName: "vm.example.ts.net",
      });
      assert.deepStrictEqual(
        yield* parseTailscale(
          JSON.stringify({
            ...status,
            CurrentTailnet: { MagicDNSEnabled: false },
          }),
        ),
        { ips: ["100.64.0.2"], dnsName: undefined },
      );
      assert.isNull(
        yield* parseTailscale(
          JSON.stringify({ ...status, BackendState: "Stopped" }),
        ),
      );
      assert.isNull(
        yield* parseTailscale(
          JSON.stringify({ BackendState: "NeedsLogin", Self: null }),
        ),
      );
      assert.deepStrictEqual(
        yield* parseTailscale(
          JSON.stringify({
            ...status,
            Self: { ...status.Self, DNSName: "invalid host" },
          }),
        ),
        { ips: ["100.64.0.2"], dnsName: undefined },
      );
    }),
  );

  it.effect("rejects malformed status and addresses", () =>
    Effect.gen(function* () {
      for (const text of [
        "not json",
        JSON.stringify({
          BackendState: "Running",
          Self: { TailscaleIPs: ["not-an-ip"] },
        }),
      ])
        assert.strictEqual(
          (yield* parseTailscale(text).pipe(Effect.result))._tag,
          "Failure",
        );
    }),
  );

  it("skips automatic opening for SSH, CI and headless Linux", () => {
    for (const platform of ["darwin", "linux", "win32"])
      for (const env of [
        { SSH_CONNECTION: "connection" },
        { SSH_CLIENT: "client" },
        { SSH_TTY: "/dev/pts/0" },
        { CI: "true" },
      ])
        assert.isFalse(canOpenBrowser(platform, env));
    assert.isFalse(canOpenBrowser("linux", {}));
    assert.isTrue(canOpenBrowser("linux", { DISPLAY: ":0" }));
    assert.isTrue(canOpenBrowser("linux", { WAYLAND_DISPLAY: "wayland-0" }));
    assert.isTrue(canOpenBrowser("darwin", {}));
  });
});
