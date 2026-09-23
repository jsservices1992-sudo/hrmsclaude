import { cookies } from "next/headers";
import { COMPANY_COOKIE, readSelectedCompany } from "./company-cookie";

export async function selectedCompanyId(): Promise<string | null> {
  return readSelectedCompany((await cookies()).get(COMPANY_COOKIE)?.value);
}
