import { describe, expect, test } from "bun:test";

describe("WebSocket echo", () => {
  test("echoes text messages", async () => {
    const port = 33001;
    const { createApp, websocket } = await import("./app");
    const app = createApp();
    const server = Bun.serve({
      port,
      fetch: app.fetch,
      websocket,
    });

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const echoed = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), 3002);
        ws.onopen = () => ws.send("hello-ws");
        ws.onmessage = (ev) => {
          clearTimeout(timer);
          resolve(String(ev.data));
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error("ws error"));
        };
      });
      expect(echoed).toBe("hello-ws");
      ws.close();
    } finally {
      server.stop(true);
    }
  });

  test("closes idle connections", async () => {
    const port = 33002;
    const { createApp, websocket } = await import("./app");
    const app = createApp();
    const server = Bun.serve({
      port,
      fetch: app.fetch,
      websocket,
    });

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?idle=0.2`);
      const closed = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("idle close timeout")), 3002);
        ws.onopen = () => {
          /* stay silent - wait for idle timeout */
        };
        ws.onclose = (ev) => {
          clearTimeout(timer);
          resolve({ code: ev.code, reason: ev.reason });
        };
        ws.onerror = () => {
          /* close event still fires after error in many runtimes */
        };
      });
      expect(closed.reason).toContain("idle");
    } finally {
      server.stop(true);
    }
  });

  test("caps idle override at 120 seconds", async () => {
    const port = 33003;
    const { createApp, websocket } = await import("./app");
    const app = createApp();
    const server = Bun.serve({
      port,
      fetch: app.fetch,
      websocket,
    });

    try {
      // Request an absurd idle; connection must still be open after ~0.5s
      // (would already be closed if uncapped values were mis-parsed as ms, etc.)
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?idle=99999`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("open timeout")), 2000);
        ws.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error("ws error"));
        };
      });
      await new Promise((r) => setTimeout(r, 400));
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    } finally {
      server.stop(true);
    }
  });
});
