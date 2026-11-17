import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MyProfile = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  verified: boolean;
  /** WIZZ Premium expiry (null when not a subscriber). */
  premium_until: string | null;
  is_private: boolean;
};

/** Shared query options so the offline cache can prefetch the same data. */
export const myProfileQueryOptions = (userId: string | null) =>
  queryOptions({
    queryKey: ["my-profile", userId] as const,
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<MyProfile | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, bio, avatar_url, verified, premium_until, is_private")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data as MyProfile | null;
    },
  });

/** The signed-in user's editable profile row; null while signed out. */
export function useMyProfile(userId: string | null) {
  return useQuery(myProfileQueryOptions(userId));
}
