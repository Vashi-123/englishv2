import { create } from 'zustand';
import { Session } from '@supabase/supabase-js';

interface AuthState {
  session: Session | null;
  loading: boolean;
  loadingSlow: boolean;
  showIntro: boolean;
  hasLoggedIn: boolean;
  needsPasswordReset: boolean;
  setSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
  setLoadingSlow: (loadingSlow: boolean) => void;
  setShowIntro: (showIntro: boolean) => void;
  setHasLoggedIn: (hasLoggedIn: boolean) => void;
  setNeedsPasswordReset: (needsPasswordReset: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  loading: true,
  loadingSlow: false,
  showIntro: true,
  hasLoggedIn: false,
  needsPasswordReset: false,
  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),
  setLoadingSlow: (loadingSlow) => set({ loadingSlow }),
  setShowIntro: (showIntro) => set({ showIntro }),
  setHasLoggedIn: (hasLoggedIn) => set({ hasLoggedIn }),
  setNeedsPasswordReset: (needsPasswordReset) => set({ needsPasswordReset }),
}));

