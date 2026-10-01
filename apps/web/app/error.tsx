"use client";

import { CrashScreen } from "@/components/errors/crash-screen";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <CrashScreen error={error} retry={retry} area="tela" />;
}
