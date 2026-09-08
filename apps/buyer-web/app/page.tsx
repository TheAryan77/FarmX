import { redirect } from "next/navigation";

import { getSessionToken } from "@/lib/session";

export default async function Page() {
  redirect((await getSessionToken()) ? "/dashboard" : "/login");
}
