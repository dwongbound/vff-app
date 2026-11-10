import { describe, expect, it } from "vitest";
import { handleMcp, type McpServer } from "@/lib/mcp";
import { AGENT_SECTIONS, AGENT_TOOLS } from "@/lib/agentTools";

const server: McpServer = {
  name: "vff-app",
  version: "1",
  instructions: "Read-only.",
  tools: [{ name: "get_my_balance", title: "Balance", description: "What you owe." }],
  callTool: async (name) => {
    if (name === "get_my_balance") return { outstandingDollars: 12.5 };
    throw new Error("nope");
  },
};
const rpc = (method: string, params?: Record<string, unknown>, id: number | null = 1) => ({
  jsonrpc: "2.0",
  // null here = a notification, which carries no id at all.
  ...(id === null ? {} : { id }),
  method,
  ...(params ? { params } : {}),
});

describe("handleMcp", () => {
  it("initializes on the client's protocol version when it knows it", async () => {
    const r = (await handleMcp(server, rpc("initialize", { protocolVersion: "2025-06-18" }))) as {
      result: { protocolVersion: string; capabilities: unknown; serverInfo: { name: string } };
    };
    expect(r.result.protocolVersion).toBe("2025-06-18");
    expect(r.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(r.result.serverInfo.name).toBe("vff-app");
  });

  it("offers its newest version to a client asking for one it doesn't know", async () => {
    const r = (await handleMcp(server, rpc("initialize", { protocolVersion: "1999-01-01" }))) as {
      result: { protocolVersion: string };
    };
    expect(r.result.protocolVersion).toBe("2025-11-25");
  });

  it("answers no notification", async () => {
    expect(await handleMcp(server, rpc("notifications/initialized", undefined, null))).toBeNull();
  });

  it("lists every tool as read-only, taking no arguments", async () => {
    const r = (await handleMcp(server, rpc("tools/list"))) as {
      result: { tools: { name: string; inputSchema: unknown; annotations: { readOnlyHint: boolean } }[] };
    };
    expect(r.result.tools[0].name).toBe("get_my_balance");
    expect(r.result.tools[0].inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    expect(r.result.tools[0].annotations.readOnlyHint).toBe(true);
  });

  it("returns a tool's data as JSON text", async () => {
    const r = (await handleMcp(server, rpc("tools/call", { name: "get_my_balance" }))) as {
      result: { content: { type: string; text: string }[]; isError: boolean };
    };
    expect(r.result.isError).toBe(false);
    expect(JSON.parse(r.result.content[0].text)).toEqual({ outstandingDollars: 12.5 });
  });

  it("refuses an unknown tool or method, and a message that isn't JSON-RPC", async () => {
    expect(await handleMcp(server, rpc("tools/call", { name: "book_airplane" }))).toMatchObject({
      error: { code: -32602 },
    });
    expect(await handleMcp(server, rpc("resources/list"))).toMatchObject({ error: { code: -32601 } });
    expect(await handleMcp(server, { hello: "world" })).toMatchObject({ error: { code: -32600 } });
  });

  it("answers a batch, minus its notifications", async () => {
    const r = await handleMcp(server, [rpc("ping", undefined, 7), rpc("notifications/x", undefined, null)]);
    expect(r).toEqual([{ jsonrpc: "2.0", id: 7, result: {} }]);
  });
});

describe("the access key's tools", () => {
  it("cover every section of the snapshot, plus the whole of it", () => {
    const sections = AGENT_TOOLS.map((t) => t.section);
    expect(sections).toContain(null);
    for (const s of AGENT_SECTIONS) expect(sections).toContain(s);
  });
  it("are all reads", () => {
    for (const t of AGENT_TOOLS) expect(t.name).toMatch(/^get_/);
  });
});
