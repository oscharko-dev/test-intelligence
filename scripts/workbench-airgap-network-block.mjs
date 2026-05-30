import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const FAILURE_MESSAGE =
  "Network and subprocess access are forbidden in the Workbench airgap verifier.";

const blocked = () => {
  throw new Error(FAILURE_MESSAGE);
};

const patchCallable = (target, name) => {
  try {
    target[name] = blocked;
  } catch {
    // Some runtimes expose read-only bindings. Leaving one unpatched is safer
    // than making the verifier depend on platform-specific descriptor shapes.
  }
};

export const installWorkbenchAirgapNetworkBlock = () => {
  globalThis.fetch = blocked;

  const net = require("node:net");
  const tls = require("node:tls");
  const http = require("node:http");
  const https = require("node:https");
  const dns = require("node:dns");
  const dgram = require("node:dgram");
  const childProcess = require("node:child_process");

  net.Socket.prototype.connect = function patchedConnect() {
    throw new Error(FAILURE_MESSAGE);
  };
  patchCallable(tls, "connect");
  patchCallable(http, "request");
  patchCallable(http, "get");
  patchCallable(https, "request");
  patchCallable(https, "get");
  patchCallable(dgram, "createSocket");
  for (const name of [
    "lookup",
    "resolve",
    "resolve4",
    "resolve6",
    "resolveAny",
    "reverse",
  ]) {
    patchCallable(dns, name);
  }
  for (const name of [
    "spawn",
    "spawnSync",
    "exec",
    "execSync",
    "execFile",
    "execFileSync",
    "fork",
  ]) {
    patchCallable(childProcess, name);
  }
};

installWorkbenchAirgapNetworkBlock();
