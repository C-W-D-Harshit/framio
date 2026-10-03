import { update } from "./update";
import { inspect } from "./inspect";
import * as Effect from "effect/Effect";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";
import { add } from "./add";
import { evidence } from "./evidence";
import { init } from "./init";
import { install } from "./install";
import { screenshot } from "./screenshot";
import { list, open, start, status, stop } from "./server";
import { serve } from "../services/server-application";
import { supervise } from "../services/session-supervisor";
import { PositiveNumber, ViewportDimension } from "../domain/project";
import { defaultHost } from "../domain/server-addresses";
const hostFlag = Flag.String("host").pipe(
  Flag.withSchema(Schema.NonEmptyString),
  Flag.withDefault(defaultHost),
  Flag.withDescription("Listen address. Use 127.0.0.1 for local-only access"),
);
const startFlags = {
  host: hostFlag,
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
        "update",
        {
          check: Flag.Boolean("check").pipe(
            Flag.withDefault(false),
            Flag.withDescription(
              "Check for a release without downloading or installing",
            ),
          ),
          download: Flag.Boolean("download").pipe(
            Flag.withDefault(false),
            Flag.withDescription(
              "Download and verify an update without installing",
            ),
          ),
          install: Flag.Boolean("install").pipe(
            Flag.withDefault(false),
            Flag.withDescription("Install an already verified download"),
          ),
          rollback: Flag.Boolean("rollback").pipe(
            Flag.withDefault(false),
            Flag.withDescription("Restore the previous installed binary"),
          ),
          status: Flag.Boolean("status").pipe(
            Flag.withDefault(false),
            Flag.withDescription(
              "Show update state without checking or installing",
            ),
          ),
        },
        update,
      ).pipe(
        Command.withAlias("upgrade"),
        Command.withDescription(
          "Check, download and install the latest Framio release",
        ),
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
        "evidence",
        {
          write: Flag.String("write").pipe(
            Flag.optional,
            Flag.withDescription("Save a validated evidence JSON document"),
          ),
          expect: Flag.String("expect").pipe(
            Flag.optional,
            Flag.withDescription(
              "Revision from framio evidence, or new for a missing file",
            ),
          ),
        },
        evidence,
      ).pipe(
        Command.withDescription(
          "Read or update the design brief, direction and screenshot reviews",
        ),
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
      makeServerCommand("__serve"),
    ]),
  );

export const runCommands = (args: string[], version: string) =>
  Command.runWith(makeRoot(), { version })(args);

const makeServerCommand = (name: "__serve" | "__supervise") =>
  Command.make(
    name,
    {
      root: Argument.String("root"),
      host: hostFlag,
      open: Flag.Boolean("open").pipe(Flag.withDefault(false)),
      terminal: Flag.Boolean("terminal").pipe(Flag.withDefault(false)),
      verbose: Flag.Boolean("verbose").pipe(Flag.withDefault(false)),
    },
    ({ root, host, open, terminal, verbose }) => {
      if (name === "__supervise")
        return supervise(root, open, { terminal, verbose, host }).pipe(
          Effect.tap((code) =>
            Effect.sync(() => {
              process.exitCode = code;
            }),
          ),
        );
      const server = serve(root, open, terminal, host);
      return terminal && !verbose
        ? server.pipe(Effect.provideService(References.MinimumLogLevel, "Warn"))
        : server;
    },
  );
export const runServerCommand = (
  name: "__serve" | "__supervise",
  args: string[],
  version: string,
) => Command.runWith(makeServerCommand(name), { version })(args);
