#!/usr/bin/env node
const { execute, queryUser } = require("./process");
const { yellow, gray, cyan } = require("chalk");

function prepend(color, pText, text) {
  return text.replace(/^/gm, `${color(pText)} `);
}

// syntax:
// > start-autorest-testserver <command-line...>

// start
//  (a) the express server, (and wait for it to be ready)
//  (b) run the given command line.
// when the (b) completes, terminate (a)

// This variable stores the exit code of the program that gets launched by
// this script so that it can be passed through for use in CI reporting, etc
let wrappedExitCode = 0;

async function main() {
  console.log(yellow("WARNING: start-autorest-express is deprecated use autorest-testserver instead."));
  const cmdArgs = [];
  const switches = [];
  let switchChecking = true;

  for (const each of process.argv.slice(2)) {
    if (switchChecking && each.startsWith("--")) {
      switches.push(each);
      continue;
    }
    switchChecking = false;
    cmdArgs.push(each);
  }
  const command = cmdArgs.shift();

  let serverProc = undefined;
  let cmdProc = undefined;
  let spResolve = undefined;
  let spReject = undefined;
  let running = false;

  const interactive = switches.indexOf("--interactive") > -1;
  const showMessages = switches.indexOf("--show-messages") > -1;
  const verbose =
    switches.indexOf("--verbose") > -1 ? (text) => console.log(prepend(cyan.bold, "[TestServer]", text)) : () => {};

  let isReady = new Promise((r, j) => {
    spResolve = r;
    spReject = j;
  });

  try {
    await execute(process.execPath, [`${__dirname}/../dist/cli/cli.js`, "stop"]);
    verbose("Shutting down existing Express instance.");
  } catch (e) {
    verbose("Express was not running previously.");
    // who cares.
  }

  // start the express process
  verbose("Starting Express Server.");
  const spResult = execute(process.execPath, [`${__dirname}/../dist/cli/cli.js`], {
    onCreate: (proc) => {
      serverProc = proc;
      proc.on("close", () => {
        if (cmdProc && cmdProc.status === null) {
          cmdProc.kill();
        }
        if (interactive) {
          process.exit(0);
        }
      });
    },
    onStdOutData: (chunk) => {
      const c = chunk.toString().replace(/\s*$/, "");
      if (showMessages) {
        console.log(prepend(gray, "[Express]", c));
      }
      if (/Server started/.exec(c)) {
        spResolve();
      }
    },
    onStdErrData: (chunk) => {
      const c = chunk.toString().replace(/\s*$/, "");
      if (showMessages) {
        console.log(prepend(yellow.dim, "[Express]", c));
      }
    },
  });

  // when it's ready, run the command line
  await isReady;
  verbose("Express is ready.");

  if (!interactive) {
    const result = await execute(command, cmdArgs, {
      onCreate: (proc) => {
        verbose(`Started command: '${command} ${cmdArgs.join(" ")}'`);
        cmdProc = proc;
        running = true;
      },
      onStdOutData: (chunk) => {
        const c = chunk.toString().replace(/\s*$/, "");
        console.log(c);
      },
      onStdErrData: (chunk) => {
        const c = chunk.toString().replace(/\s*$/, "");
        console.error(c);
      },
    });
    running = false;
    verbose("Command completed.");

    // Store the exit code so that it can be returned when this process exits
    wrappedExitCode = result.error;
  } else {
    await queryUser("\n\nPress enter to stop testserver\n");
  }
  cmdProc = undefined;

  // after the cmdline is done.
  // shutdown server process
  verbose("Shutting down Express.");
  try {
    await execute(process.execPath, [`${__dirname}/../dist/cli/cli.js`, "stop"]);
    verbose("Shutting down existing Express instance.");
  } catch (e) {
    // who cares.
  }

  // wait for it to close
  verbose("Waiting for Express to finish.");

  // force-kill server process
  if (serverProc && serverProc.status === null) {
    verbose("killing express");
    serverProc.kill();
  }

  await spResult;
  verbose("Exiting.");
}
async function start() {
  try {
    await main();
    process.exit(wrappedExitCode);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

start();
