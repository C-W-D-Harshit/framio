import { upgrade } from "./upgrade";
import { inspect } from "./inspect";
import * as Effect from "effect/Effect";
import { Argument, Command, Flag } from "effect/cli";
import { add } from "./add";
import { init } from "./init";
import { install } from "./install";
import { screenshot } from "./screenshot";
import { list, open, start, status, stop } from "./server";
import { serve } from "../services/server-application";
import { PositiveNumber, ViewportDimension } from "../domain/project";
const startFlags = {
  background: Flag.Boolean("background").pipe(Flag.withDefault(false)),
  noOpen: Flag.Boolean("no-open").pipe(Flag.withDefault(false)),
};
const makeRoot = () =>
  Command.make("framio", startFlags, start).pipe(
    Command.withDescription("A design canvas for coding agents"),
    Command.withSubcommands([
      Command.make("start", startFlags, start),
      Command.make(
        "upgrade",
        {
          check: Flag.Boolean("check").pipe(Flag.withDefault(false)),
          download: Flag.Boolean("download").pipe(Flag.withDefault(false)),
          install: Flag.Boolean("install").pipe(Flag.withDefault(false)),
          rollback: Flag.Boolean("rollback").pipe(Flag.withDefault(false)),
        },
        upgrade,
      ),
      Command.make(
        "init",
        {
          skipInstall: Flag.Boolean("skip-install").pipe(
            Flag.withDefault(false),
          ),
        },
        ({ skipInstall }) => init(skipInstall),
      ),
      Command.make(
        "stop",
        { all: Flag.Boolean("all").pipe(Flag.withDefault(false)) },
        ({ all }) => stop(all),
      ),
      Command.make("list", {}, () => list),
      Command.make("status", {}, () => status),
      Command.make("open", {}, () => open),
      Command.make(
        "install",
        { packages: Argument.String("package").pipe(Argument.variadic()) },
        ({ packages }) => install(packages),
      ),
      Command.make(
        "add",
        {
          items: Argument.String("item").pipe(Argument.variadic()),
          overwrite: Flag.Boolean("overwrite").pipe(Flag.withDefault(false)),
        },
        ({ items, overwrite }) => add(items, overwrite),
      ),
      Command.make(
        "inspect",
        {
          frame: Argument.String("frame"),
          width: Flag.Finite("width").pipe(
            Flag.withSchema(ViewportDimension),
            Flag.optional,
          ),
          layer: Flag.String("layer").pipe(Flag.optional),
        },
        inspect,
      ),
      Command.make(
        "screenshot",
        {
          frames: Argument.String("frame").pipe(Argument.variadic()),
          layers: Flag.String("layer").pipe(Flag.atLeast(0)),
          page: Flag.String("page").pipe(Flag.optional),
          url: Flag.String("url").pipe(Flag.optional),
          compare: Flag.String("compare").pipe(Flag.optional),
          into: Flag.String("into").pipe(Flag.optional),
          width: Flag.Finite("width").pipe(
            Flag.withSchema(ViewportDimension),
            Flag.optional,
          ),
          height: Flag.Finite("height").pipe(
            Flag.withSchema(ViewportDimension),
            Flag.optional,
          ),
          all: Flag.Boolean("all").pipe(Flag.withDefault(false)),
          scale: Flag.Finite("scale").pipe(
            Flag.withDefault(1),
            Flag.withSchema(PositiveNumber),
          ),
        },
        screenshot,
      ),
      Command.make(
        "__serve",
        {
          root: Argument.String("root"),
          open: Flag.Boolean("open").pipe(Flag.withDefault(false)),
        },
        ({ root, open }) => serve(root, open),
      ),
    ]),
  );

export const runCommands = (args: string[], version: string) =>
  Command.runWith(makeRoot(), { version })(args);
