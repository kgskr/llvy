import { canManage } from "@/lib/capabilities";
import { getMembersReadModel } from "@/lib/read-model";

import { MemberList } from "./member-list";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const { members, role } = await getMembersReadModel();

  return <MemberList members={members} isAdmin={canManage(role)} />;
}
