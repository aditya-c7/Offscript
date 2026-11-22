import { createServer } from "node:net";
import { z } from "zod";

const PortSchema = z.object({ port: z.number().int().min(1).max(65535) });

export function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

/** Ask the OS for a free loopback port, then release it before use. */
export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const parsed = PortSchema.safeParse(server.address());
      server.close((closeError) => {
        if (closeError) {
          rejectPort(closeError);
          return;
        }
        if (!parsed.success) {
          rejectPort(new Error("Could not determine a free loopback port"));
          return;
        }
        resolvePort(parsed.data.port);
      });
    });
  });
}
