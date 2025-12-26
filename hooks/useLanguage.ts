import { useState, useEffect } from 'react';
import { Locale, translations } from '../i18n/translations';

export const useLanguage = () => {
  const [language, setLanguage] = useState<Locale>(() => {
    const saved = localStorage.getItem('ui_language');
    // UI language is currently fixed to Russian.
    return saved === 'ru' ? 'ru' : 'ru';
  });

  useEffect(() => {
    localStorage.setItem('ui_language', 'ru');
  }, [language]);

  const copy = translations.ru;
  const languages: { code: Locale; label: string }[] = [{ code: 'ru', label: 'Русский' }];

  const setRussianOnly = (next: Locale) => {
    void next;
    setLanguage('ru');
  };

  return {
    language,
    setLanguage: setRussianOnly,
    copy,
    languages,
  };
};
