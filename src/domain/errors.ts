import * as Schema from "effect/Schema";

export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", { message: Schema.String }) {}
export class InvalidInput extends Schema.TaggedError<InvalidInput>()("InvalidInput", { message: Schema.String }) {}
export class ServerStartupFailed extends Schema.TaggedError<ServerStartupFailed>()("ServerStartupFailed", { message: Schema.String }) {}
export class ServerIdentityMismatch extends Schema.TaggedError<ServerIdentityMismatch>()("ServerIdentityMismatch", { message: Schema.String }) {}
export class PackageCommandFailed extends Schema.TaggedError<PackageCommandFailed>()("PackageCommandFailed", { message: Schema.String }) {}
export class BrowserUnavailable extends Schema.TaggedError<BrowserUnavailable>()("BrowserUnavailable", { message: Schema.String }) {}
export class CaptureFailed extends Schema.TaggedError<CaptureFailed>()("CaptureFailed", { message: Schema.String }) {}

export class PortOccupied extends Schema.TaggedError<PortOccupied>()("PortOccupied", { port: Schema.Int }) {}
