import { Rpc, RpcGroup } from "effect/rpc";
import { Snapshot } from "./snapshot";
/** The versioned procedure name detects an incompatible running internal UI/server. */
export class LiveRpc extends RpcGroup.make(
  Rpc.make("snapshotsV1", { success: Snapshot, stream: true }),
) {}
