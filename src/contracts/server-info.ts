import * as Schema from "effect/Schema";
import { PositiveNumber } from "../domain/project";

export const ServerInfo = Schema.Struct({
  pid: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
  port: PositiveNumber,
  url: Schema.String,
  startedAt: Schema.String,
});
export type ServerInfo = typeof ServerInfo.Type;
export const RegisteredServer = Schema.Struct({ ...ServerInfo.fields, root: Schema.String });
export type RegisteredServer = typeof RegisteredServer.Type;
export const Health = Schema.Struct({ ok: Schema.Boolean, root: Schema.String, pid: Schema.Int, protocol: Schema.optional(Schema.String) });
