import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useRepositories } from '@/core/database/repositories';
import type { InterfaceLanguage } from '@/features/settings/domain/settings';
import { strings as englishStrings, type Translations } from './en';
import { frenchStrings } from './fr';
import { swahiliStrings } from './sw';

const translations: Record<InterfaceLanguage, Translations> = {
  en: englishStrings,
  fr: frenchStrings,
  sw: swahiliStrings,
};

const localeTags: Record<InterfaceLanguage, string> = {
  en: 'en',
  fr: 'fr',
  sw: 'sw',
};

type I18nContextValue = {
  language: InterfaceLanguage;
  localeTag: string;
  strings: Translations;
  translateText: (text: string) => string;
  setLanguage: (language: InterfaceLanguage) => Promise<void>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: PropsWithChildren) {
  const { settings } = useRepositories();
  const [language, setCurrentLanguage] = useState<InterfaceLanguage>('en');

  useEffect(() => {
    let active = true;
    settings.getInterfaceLanguage()
      .then((stored) => { if (active) setCurrentLanguage(stored); })
      .catch(() => { /* English remains the safe offline fallback. */ });
    return () => { active = false; };
  }, [settings]);

  const setLanguage = useCallback(async (next: InterfaceLanguage) => {
    const verified = await settings.setInterfaceLanguage(next);
    setCurrentLanguage(verified);
  }, [settings]);

  const translateText = useCallback((text: string) => {
    const key = (Object.keys(englishStrings) as Array<keyof Translations>)
      .find((candidate) => englishStrings[candidate] === text);
    return key ? translations[language][key] : text;
  }, [language]);

  const value = useMemo<I18nContextValue>(() => ({
    language,
    localeTag: localeTags[language],
    strings: translations[language],
    translateText,
    setLanguage,
  }), [language, setLanguage, translateText]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('I18nProvider is missing.');
  return value;
}

export { translations };
