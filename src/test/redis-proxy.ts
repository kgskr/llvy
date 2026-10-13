import { createConnection, createServer, type Socket } from "node:net";

/** Disposable loopback proxy for withholding real Redis replies, never production. */
export async function createRedisProxy(target: string) {
  const url = new URL(target);
  if (url.protocol !== "redis:" || url.hostname !== "127.0.0.1")
    throw new Error("Redis proxy requires a disposable loopback target");
  const sockets = new Set<Socket>();
  let stalled = false;
  const server = createServer((downstream) => {
    const upstream = createConnection({
      host: "127.0.0.1",
      port: Number(url.port || 6379),
    });
    for (const socket of [downstream, upstream]) {
      sockets.add(socket);
      socket.on("error", () => {
        downstream.destroy();
        upstream.destroy();
      });
      socket.on("close", () => sockets.delete(socket));
    }
    downstream.on("close", () => upstream.destroy());
    upstream.on("close", () => downstream.destroy());
    downstream.pipe(upstream);
    upstream.on("data", (data) => {
      if (!stalled) downstream.write(data);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing proxy port");
  return {
    url: `redis://127.0.0.1:${address.port}`,
    stall() {
      stalled = true;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
