import { describe, expect, it } from "vitest";
import { handleMcp, type McpServer } from "@/lib/mcp";
import {
  AGENT_SECTIONS,
  AGENT_TOOLS,
  AGENT_WRITE_TOOLS,
  agentInstructions,
  agentToolsFor,
} from "@/lib/agentTools";

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

  it("lists a writing tool with its arguments and hints, and passes the arguments on", async () => {
    const seen: Record<string, unknown>[] = [];
    const writer: McpServer = {
      ...server,
      tools: [
        {
          name: "cancel_booking",
          title: "Cancel",
          description: "Cancel one.",
          readOnly: false,
          destructive: true,
          inputSchema: { type: "object", properties: { bookingId: { type: "string" } } },
        },
      ],
      callTool: async (_name, args) => {
        seen.push(args);
        return { cancelled: true };
      },
    };
    const list = (await handleMcp(writer, rpc("tools/list"))) as {
      result: { tools: { inputSchema: unknown; annotations: Record<string, boolean> }[] };
    };
    expect(list.result.tools[0].inputSchema).toMatchObject({ properties: { bookingId: {} } });
    expect(list.result.tools[0].annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });

    await handleMcp(writer, rpc("tools/call", { name: "cancel_booking", arguments: { bookingId: "b1" } }));
    // Missing or non-object arguments arrive as {}.
    await handleMcp(writer, rpc("tools/call", { name: "cancel_booking", arguments: [1] }));
    expect(seen).toEqual([{ bookingId: "b1" }, {}]);
  });

  it("returns a tool that threw as a readable error result", async () => {
    const failing: McpServer = {
      ...server,
      callTool: async () => {
        throw new Error("N8318B is already booked then.");
      },
    };
    const r = (await handleMcp(failing, rpc("tools/call", { name: "get_my_balance" }))) as {
      result: { content: { text: string }[]; isError: boolean };
    };
    expect(r.result).toEqual({ content: [{ type: "text", text: "N8318B is already booked then." }], isError: true });
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

describe("a key that may write", () => {
  it("gets the five writing tools; a read-only key doesn't", () => {
    expect(agentToolsFor(false).map((t) => t.name)).toEqual(AGENT_TOOLS.map((t) => t.name));
    expect(agentToolsFor(true).map((t) => t.name)).toEqual([
      ...AGENT_TOOLS.map((t) => t.name),
      "book_airplane",
      "update_booking",
      "cancel_booking",
      "file_flight",
      "update_flight",
    ]);
  });
  it("marks every writer as not read-only, and only cancelling as destructive", () => {
    for (const t of AGENT_WRITE_TOOLS) expect(t.readOnly).toBe(false);
    expect(AGENT_WRITE_TOOLS.filter((t) => t.destructive).map((t) => t.name)).toEqual(["cancel_booking"]);
  });
  it("is told what its key may do", () => {
    expect(agentInstructions(false)).toMatch(/read-only/);
    expect(agentInstructions(true)).toMatch(/book the airplane/);
    expect(agentInstructions(true)).toMatch(/change or cancel/);
    expect(agentInstructions(true)).toMatch(/can pay/);
  });
});
