// POST /api/mcp — the club app as an MCP server, for a member's own assistant
// (Jarvis). Stateless Streamable HTTP: one JSON-RPC message (or batch) per
// POST, a plain JSON reply, tools only, every tool read-only. Protocol rules in
// lib/mcp.ts, tools in lib/agentTools.ts, data in lib/agentSnapshot.ts.
//
// Authenticated by `Authorization: Bearer vff_…` ONLY, like /api/agent.
import { NextResponse } from "next/server";
import { getKeyUser } from "@/lib/accessKeyAuth";
import { agentSection, agentSnapshot } from "@/lib/agentSnapshot";
import { AGENT_INSTRUCTIONS, AGENT_TOOLS } from "@/lib/agentTools";
import { handleMcp, parseErrorReply } from "@/lib/mcp";

export async function POST(req: Request) {
  const user = await getKeyUser(req);
  if (!user) {
    return NextResponse.json(
      { error: "Send a personal access key: Authorization: Bearer vff_… (make one on your profile)." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="vff"' } }
    );
  }

  const body = await req.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json(parseErrorReply(), { status: 400 });

  const replies = await handleMcp(
    {
      name: "vff-app",
      version: "1",
      instructions: AGENT_INSTRUCTIONS,
      tools: AGENT_TOOLS,
      callTool: async (name) => {
        const tool = AGENT_TOOLS.find((t) => t.name === name)!;
        return tool.section ? agentSection(user, tool.section) : agentSnapshot(user);
      },
    },
    body
  );
  // Only notifications: accepted, nothing to say.
  if (replies === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(replies, { headers: { "Cache-Control": "no-store" } });
}

/**
 * No server-to-client stream: the spec lets a server that never pushes answer
 * GET with 405, and a client then simply POSTs.
 */
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
