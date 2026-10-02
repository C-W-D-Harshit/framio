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
  verbose: Flag.Boolean("verbose").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Show runtime build diagnostics"),
  ),
  background: Flag.Boolean("background").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Run the canvas in the background"),
  ),
  noOpen: Flag.Boolean("no-open").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Start without opening the browser"),
  ),
};
const verbose = Flag.Boolean("verbose").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Show full subprocess output"),
);
const makeRoot = () =>
  Command.make("framio", startFlags, start).pipe(
    Command.withDescription("A design canvas for coding agents"),
    Command.withSubcommands([
      Command.make("start", startFlags, start).pipe(
        Command.withDescription("Open the canvas and watch your designs"),
      ),
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
          verbose,
          skipInstall: Flag.Boolean("skip-install").pipe(
            Flag.withDefault(false),
          ),
        },
        ({ skipInstall, verbose }) => init(skipInstall, verbose),
      ).pipe(
        Command.withDescription(
          "Set up a canvas and agent skills in this project",
        ),
      ),
      Command.make(
        "stop",
        { all: Flag.Boolean("all").pipe(Flag.withDefault(false)) },
        ({ all }) => stop(all),
      ).pipe(
        Command.withDescription("Stop this canvas, or every canvas with --all"),
      ),
      Command.make("list", {}, () => list).pipe(
        Command.withDescription("List running canvases"),
      ),
      Command.make("status", {}, () => status).pipe(
        Command.withDescription("Check this canvas"),
      ),
      Command.make("open", {}, () => open).pipe(
        Command.withDescription("Open an already running canvas"),
      ),
      Command.make(
        "install",
        {
          packages: Argument.String("package").pipe(Argument.variadic()),
          verbose,
        },
        ({ packages, verbose }) => install(packages, verbose),
      ).pipe(Command.withDescription("Install design packages")),
      Command.make(
        "add",
        {
          items: Argument.String("item").pipe(Argument.variadic()),
          overwrite: Flag.Boolean("overwrite").pipe(Flag.withDefault(false)),
          verbose,
        },
        ({ items, overwrite, verbose }) => add(items, overwrite, verbose),
      ).pipe(Command.withDescription("Add components from a shadcn registry")),
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
      ).pipe(
        Command.withDescription("Inspect frame geometry and styles as JSON"),
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
      ).pipe(Command.withDescription("Capture frames, layers or a website")),
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
