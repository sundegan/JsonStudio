import { writable, derived } from 'svelte/store';
import zh from './locales/zh';
import en from './locales/en';

export type Locale = 'zh' | 'en';
export type TranslationKey = keyof typeof zh;

const translations: Record<Locale, Record<string, string>> = { zh, en };

export const localeNames: Record<Locale, string> = {
  zh: '中文',
  en: 'English',
};

export const availableLocales = Object.keys(localeNames) as Locale[];

export const locale = writable<Locale>('zh');

export const t = derived(locale, ($locale) => {
  const dict = translations[$locale] || translations.zh;
  return (key: TranslationKey | string): string => dict[key as string] || (key as string);
});
