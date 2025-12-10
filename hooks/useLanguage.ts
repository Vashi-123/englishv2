import { useState, useEffect } from 'react';
import { Locale, translations } from '../i18n/translations';

export const useLanguage = () => {
  const [language, setLanguage] = useState<Locale>(() => {
    const saved = localStorage.getItem('ui_language');
    return (saved === 'ru' || saved === 'en') ? saved : 'ru';
  });

  useEffect(() => {
    localStorage.setItem('ui_language', language);
  }, [language]);

  const copy = translations[language];
  const languages: { code: Locale; label: string }[] = [
    { code: 'ru', label: 'Русский' },
    { code: 'en', label: 'English' },
  ];

  return {
    language,
    setLanguage,
    copy,
    languages,
  };
};

