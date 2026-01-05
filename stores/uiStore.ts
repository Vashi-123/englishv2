import { create } from 'zustand';

interface UIState {
  // Modals
  showInsightPopup: boolean;
  insightPopupActive: boolean;
  showWordsModal: boolean;
  wordsModalActive: boolean;
  showGrammarModal: boolean;
  grammarModalActive: boolean;
  showCourseTopics: boolean;
  
  // Confirm modal
  confirmAction: 'reset' | 'signout' | 'deleteAccount' | 'restorePurchases' | null;
  confirmVisible: boolean;
  
  // Premium gate
  premiumGateLesson: number | null;
  premiumGateVisible: boolean;
  
  // Paywall
  paywallLesson: number | null;
  
  // Status checking
  isCheckingStatus: boolean;
  
  // Actions
  setShowInsightPopup: (show: boolean) => void;
  setInsightPopupActive: (active: boolean) => void;
  setShowWordsModal: (show: boolean) => void;
  setWordsModalActive: (active: boolean) => void;
  setShowGrammarModal: (show: boolean) => void;
  setGrammarModalActive: (active: boolean) => void;
  setShowCourseTopics: (show: boolean) => void;
  setConfirmAction: (action: 'reset' | 'signout' | 'deleteAccount' | 'restorePurchases' | null) => void;
  setConfirmVisible: (visible: boolean) => void;
  setPremiumGateLesson: (lesson: number | null) => void;
  setPremiumGateVisible: (visible: boolean) => void;
  setPaywallLesson: (lesson: number | null) => void;
  setIsCheckingStatus: (checking: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  showInsightPopup: false,
  insightPopupActive: false,
  showWordsModal: false,
  wordsModalActive: false,
  showGrammarModal: false,
  grammarModalActive: false,
  showCourseTopics: false,
  confirmAction: null,
  confirmVisible: false,
  premiumGateLesson: null,
  premiumGateVisible: false,
  paywallLesson: null,
  isCheckingStatus: false,
  setShowInsightPopup: (show) => set({ showInsightPopup: show }),
  setInsightPopupActive: (active) => set({ insightPopupActive: active }),
  setShowWordsModal: (show) => set({ showWordsModal: show }),
  setWordsModalActive: (active) => set({ wordsModalActive: active }),
  setShowGrammarModal: (show) => set({ showGrammarModal: show }),
  setGrammarModalActive: (active) => set({ grammarModalActive: active }),
  setShowCourseTopics: (show) => set({ showCourseTopics: show }),
  setConfirmAction: (action) => set({ confirmAction: action }),
  setConfirmVisible: (visible) => set({ confirmVisible: visible }),
  setPremiumGateLesson: (lesson) => set({ premiumGateLesson: lesson }),
  setPremiumGateVisible: (visible) => set({ premiumGateVisible: visible }),
  setPaywallLesson: (lesson) => set({ paywallLesson: lesson }),
  setIsCheckingStatus: (checking) => set({ isCheckingStatus: checking }),
}));

