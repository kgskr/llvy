import { NextResponse } from "next/server";
import {
  cleanupExpiredAuthentication,
  reconcileGuildAccounts,
} from "@/lib/auth-maintenance";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== "Bearer " + secret)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cleanup = await cleanupExpiredAuthentication();
  try {
    return NextResponse.json(
      { cleanup, membership: await reconcileGuildAccounts() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { cleanup, membership: { status: "unavailable" } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
