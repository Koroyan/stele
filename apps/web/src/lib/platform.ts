"use client";
/**
 * Stele as a customer of itself: the organization that publishes Stele's Terms and Privacy Policy,
 * and whether the AI assistant is on — read once per page load from the API.
 */
import { useEffect, useState } from "react";
import { api } from "./api";

export interface PlatformDocument {
  slug: string;
  address: string;
  version: { number: number; label: string; title: string; address: string } | null;
}

export interface Platform {
  organization: string | null;
  terms: PlatformDocument | null;
  privacy: PlatformDocument | null;
  assistant: { enabled: boolean };
}

const OFF: Platform = {
  organization: null,
  terms: null,
  privacy: null,
  assistant: { enabled: false },
};

let cached: Promise<Platform> | null = null;
export function loadPlatform(): Promise<Platform> {
  cached ??= api<Platform>("/v1/public/platform").catch(() => {
    cached = null;
    return OFF;
  });
  return cached;
}

export function usePlatform(): Platform | null {
  const [platform, setPlatform] = useState<Platform | null>(null);
  useEffect(() => {
    let live = true;
    void loadPlatform().then((p) => live && setPlatform(p));
    return () => {
      live = false;
    };
  }, []);
  return platform;
}
