import { redirect } from "next/navigation";

import { getSessionToken } from "@/lib/session";

export default async function IndexPage() {
  redirect((await getSessionToken()) ? "/dashboard" : "/login");
}
