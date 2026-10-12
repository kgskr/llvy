import { members } from "@/db/schema";
import { db } from "@/test/database";

/** Setup data only; mutation assertions must use the protected services. */
export async function createMemberFixture(
  name: string,
  birthYear: number | null,
): Promise<string> {
  const [row] = await db
    .insert(members)
    .values({ name, birthYear })
    .returning({ id: members.id });
  return row.id;
}
