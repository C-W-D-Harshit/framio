import * as Schema from "effect/Schema";
import { PositiveNumber } from "../domain/project";

export const ServerUrl = Schema.Struct({
  kind: Schema.Literals(["local", "network", "tailscale"]),
  url: Schema.String,
});
export type ServerUrl = typeof ServerUrl.Type;
export const ServerInfo = Schema.Struct({
  pid: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
  port: PositiveNumber,
  url: Schema.String,
  startedAt: Schema.String,
  version: Schema.optional(Schema.String),
  installationId: Schema.optional(Schema.String),
  supervisorPid: Schema.optional(Schema.Int),
  host: Schema.optional(Schema.String),
  urls: Schema.optional(Schema.Array(ServerUrl)),
});
export type ServerInfo = typeof ServerInfo.Type;
export const RegisteredServer = Schema.Struct({
  ...ServerInfo.fields,
  root: Schema.String,
});
export type RegisteredServer = typeof RegisteredServer.Type;
export const Health = Schema.Struct({
  ok: Schema.Boolean,
  root: Schema.String,
  pid: Schema.Int,
  protocol: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
});
