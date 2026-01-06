// Utility functions
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Type definitions required by shadcn-svelte
export type WithoutChild<T> = Omit<T, 'child' | 'children'> & {
  children?: Snippet;
};

export type WithoutChildrenOrChild<T> = Omit<T, 'child' | 'children'>;

export type WithElementRef<T extends HTMLElement = HTMLElement> = {
  ref?: T | null;
} & HTMLAttributes<T>;
