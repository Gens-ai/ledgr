import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

// Injected at build time from package.json (see next.config.ts).
const APP_VERSION = process.env.APP_VERSION ?? "unknown";

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({
      status: "ok",
      version: APP_VERSION,
      db: "connected",
    });
  } catch {
    return NextResponse.json(
      { status: "error", version: APP_VERSION, db: "disconnected" },
      { status: 503 }
    );
  }
}
