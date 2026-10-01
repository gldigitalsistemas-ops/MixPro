"use client";

import { useEffect } from "react";
import { installErrorReporting } from "@/lib/error-log";

/** Liga o registro de erros e de quedas da página (aba Logs do admin). */
export function ErrorReporter() {
  useEffect(() => installErrorReporting(), []);
  return null;
}
