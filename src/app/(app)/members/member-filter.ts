import { riotId } from "@/lib/format";

type SearchableMember = {
  name: string;
  accounts: { gameName: string; tagLine: string }[];
};

function normalize(value: string) {
  return value.normalize("NFC").trim().toLowerCase();
}

export function filterMembers<T extends SearchableMember>(
  members: T[],
  query: string,
): T[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return members;

  return members.filter(
    (member) =>
      normalize(member.name).includes(normalizedQuery) ||
      member.accounts.some((account) =>
        normalize(riotId(account.gameName, account.tagLine)).includes(
          normalizedQuery,
        ),
      ),
  );
}
