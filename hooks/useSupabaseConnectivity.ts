import { useEffect, useState } from 'react';
import { getSupabaseConnectivity, subscribeSupabaseConnectivity, SupabaseConnectivity } from '../services/supabaseClient';

export const useSupabaseConnectivity = () => {
  const [state, setState] = useState<SupabaseConnectivity>(() => getSupabaseConnectivity());

  useEffect(() => {
    const unsubscribe = subscribeSupabaseConnectivity(setState);
    return unsubscribe;
  }, []);

  return state;
};
