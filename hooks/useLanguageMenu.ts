import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

export const useLanguageMenu = () => {
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [langMenuVisible, setLangMenuVisible] = useState(false);
  const langMenuRef = useRef<HTMLDivElement | null>(null);
  const [langMenuPos, setLangMenuPos] = useState<{ top: number; left: number } | null>(null);

  const openLangMenu = useCallback(() => {
    setShowLangMenu(true);
  }, []);

  const closeLangMenu = useCallback(() => {
    setLangMenuVisible(false);
    window.setTimeout(() => {
      setShowLangMenu(false);
    }, 320);
  }, []);

  useEffect(() => {
    if (!showLangMenu) return;
    const raf = window.requestAnimationFrame(() => setLangMenuVisible(true));
    return () => window.cancelAnimationFrame(raf);
  }, [showLangMenu]);

  useLayoutEffect(() => {
    if (!showLangMenu) {
      setLangMenuPos(null);
      return;
    }
    const update = () => {
      const anchor = langMenuRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const menuWidth = 320; // w-80
      const margin = 12;
      const minLeft = 16;
      const maxLeft = Math.max(minLeft, window.innerWidth - menuWidth - minLeft);
      const left = Math.min(Math.max(minLeft, Math.round(rect.left)), Math.round(maxLeft));
      const top = Math.max(16, Math.round(rect.bottom + margin));
      setLangMenuPos({ top, left });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [showLangMenu]);

  return {
    showLangMenu,
    langMenuVisible,
    langMenuRef,
    langMenuPos,
    openLangMenu,
    closeLangMenu,
  };
};

