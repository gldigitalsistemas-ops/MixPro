"use client";

import { useEffect } from "react";
import { REF_STORAGE_KEY } from "@/lib/account";

export function SaveReferral({ code }: { code: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(REF_STORAGE_KEY, code);
    } catch {}
  }, [code]);
  return null;
}
