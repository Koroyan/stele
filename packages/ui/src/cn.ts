import { clsx, type ClassValue } from "clsx";

/** Joins class names (falsy values dropped). */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
