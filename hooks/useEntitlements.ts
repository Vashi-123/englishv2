import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../services/supabaseClient";

type UserEntitlementsRow = {
  user_id: string;
  is_premium: boolean;
  premium_until: string | null;
};

const isPremiumEffective = (row: Pick<UserEntitlementsRow, "is_premium" | "premium_until"> | null): boolean => {
  if (!row) return false;
  if (row.is_premium) return true;
  if (!row.premium_until) return false;
  const until = Date.parse(row.premium_until);
  if (!Number.isFinite(until)) return false;
  return until > Date.now();
};

export const useEntitlements = (userId?: string) => {
  const [loading, setLoading] = useState(false);
  const [row, setRow] = useState<UserEntitlementsRow | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setRow(null);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from("user_entitlements")
        .select("user_id,is_premium,premium_until")
        .eq("user_id", userId)
        .maybeSingle();
      if (fetchError) throw fetchError;
      setRow((data as UserEntitlementsRow) || null);
      setError(null);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;

    if (channelRef.current) {
      try {
        supabase.removeChannel(channelRef.current);
      } catch {
        // ignore
      }
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`user_entitlements_${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_entitlements", filter: `user_id=eq.${userId}` }, () => {
        void refresh();
      })
      .subscribe();
    channelRef.current = channel;

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [refresh, userId]);

  const isPremium = useMemo(() => isPremiumEffective(row), [row]);

  return { isPremium, entitlements: row, loading, error, refresh };
};

