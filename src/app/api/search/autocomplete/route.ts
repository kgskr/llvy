import { NextResponse } from "next/server";
import {
  autocompleteSearch,
  autocompleteStoredNicknames,
} from "@/lib/nickname-search";
import { UnauthorizedError } from "@/lib/auth-errors";
import { assertSession } from "@/lib/session";
import {
  parseSearchInput,
  projectSearchSuggestion,
} from "@/lib/search-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    await assertSession();
    const params = new URL(request.url).searchParams;
    const values = (key: string) =>
      params.has(key) ? params.getAll(key) : undefined;
    const q = values("q"),
      nickname = values("nickname");
    const search = parseSearchInput({
      q: q?.length === 1 ? q[0] : q,
      nickname: nickname?.length === 1 ? nickname[0] : nickname,
    });
    if (!search)
      return NextResponse.json(
        { error: "Invalid search parameters." },
        { status: 400, headers },
      );
    const suggestions =
      search.mode === "nickname"
        ? (await autocompleteStoredNicknames(search.input))
            .slice(0, 10)
            .map(({ id, gameName, tagLine }) => ({ id, gameName, tagLine }))
        : (await autocompleteSearch(search.input)).slice(0, 10).map((entry) => {
            const safe = projectSearchSuggestion(entry);
            if (!safe) throw new Error("Invalid suggestion");
            return safe;
          });
    return NextResponse.json({ suggestions }, { headers });
  } catch (error) {
    if (error instanceof UnauthorizedError)
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers },
      );
    return NextResponse.json(
      { error: "Autocomplete is unavailable." },
      { status: 503, headers },
    );
  }
}
