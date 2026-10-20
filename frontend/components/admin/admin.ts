import { useQuery } from "@tanstack/react-query";
import { fetchAdminIdentity } from "@/backend/api/admin.functions";

/**
 * Server-verified admin status. The server (admin_roles table + email
 * allowlist, see backend/api/admin-auth.ts) is the single source of truth;
 * the UI just renders its answer, so client and server can never disagree
 * about who is an admin — and admin emails never ship in the JS bundle.
 */
export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-identity"],
    queryFn: () => fetchAdminIdentity(),
    staleTime: 60_000,
    retry: false,
  });
  return { isAdmin: data?.isAdmin === true, isLoading };
}
