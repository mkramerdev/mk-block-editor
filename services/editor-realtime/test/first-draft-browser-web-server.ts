import { spawn, type ChildProcess } from "node:child_process";
import { createServer, request as requestHttp } from "node:http";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const publicPort = 3010;
const nextPort = 3011;
let nextProcess = startNext();
let restarting: Promise<void> | null = null;

const proxy = createServer((request, response) => {
  if (
    request.method === "POST" &&
    request.url === "/__first-draft-test/restart-web"
  ) {
    restarting ??= restartNext().finally(() => {
      restarting = null;
    });
    void restarting.then(
      () => {
        response.writeHead(204);
        response.end();
      },
      (error: unknown) => {
        console.error("First Draft browser web restart failed", error);
        response.writeHead(500);
        response.end();
      },
    );
    return;
  }
  const upstream = requestHttp(
    {
      hostname: "127.0.0.1",
      port: nextPort,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: `127.0.0.1:${nextPort}` },
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
});

await new Promise<void>((resolveListen) =>
  proxy.listen(publicPort, "127.0.0.1", resolveListen),
);

async function restartNext(): Promise<void> {
  await stopNext(nextProcess);
  nextProcess = startNext();
  await waitForNext();
}

function startNext(): ChildProcess {
  const nextCli = resolve(
    repositoryRoot,
    "apps/web/node_modules/next/dist/bin/next",
  );
  const child = spawn(
    process.execPath,
    [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(nextPort)],
    {
      cwd: resolve(repositoryRoot, "apps/web"),
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: "inherit",
    },
  );
  child.once("exit", (code) => {
    if (code && code !== 0)
      console.error(`First Draft web exited with ${code}`);
  });
  return child;
}

async function stopNext(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolveExit) =>
    child.once("exit", () => resolveExit()),
  );
  child.kill("SIGTERM");
  await exited;
}

async function waitForNext(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${nextPort}/test/editor/first-draft`,
      );
      if (response.ok) return;
    } catch {
      // The replacement process is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("First Draft web did not become ready after restart");
}

async function shutdown(): Promise<void> {
  await stopNext(nextProcess);
  await new Promise<void>((resolveClose, reject) =>
    proxy.close((error) => (error ? reject(error) : resolveClose())),
  );
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
