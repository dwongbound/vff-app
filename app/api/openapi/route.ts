// GET /api/openapi — the OpenAPI 3.1 description of what a personal access
// key can reach (GET /api/agent and POST /api/mcp), for whoever is writing a
// client against them. Public on purpose: it describes the shape of the API,
// never any data, and /api-docs.html (public/) renders it with Swagger UI.
// The document itself is lib/openapi.json; tests/unit/openapi.test.ts keeps
// its tools and labels in step with the code.
import { NextResponse } from "next/server";
import spec from "@/lib/openapi.json";

export function GET() {
  return NextResponse.json(spec, {
    headers: {
      // Swagger UI and other tools fetch it cross-origin.
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
}
