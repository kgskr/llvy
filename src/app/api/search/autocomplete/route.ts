import { NextResponse } from "next/server";
import { autocompleteStoredNicknames } from "@/lib/nickname-search";
import { UnauthorizedError } from "@/lib/auth-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const nickname = new URL(request.url).searchParams.get("nickname") ?? "";
    const suggestions = (await autocompleteStoredNicknames(nickname))
      .slice(0, 10)
      .map(({ id, gameName, tagLine }) => ({ id, gameName, tagLine }));
    return NextResponse.json({ suggestions }, { headers });
  } catch (error) {
    if (error instanceof UnauthorizedError)
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers },
      );
    return NextResponse.json(
      { error: "Autocomplete is unavailable." },
      { status: 500, headers },
    );
  }
}
