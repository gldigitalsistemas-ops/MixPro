"use client";

import { useState } from "react";
import { LoginFields, SignupFields } from "@/components/auth/auth-form";
import { Modal } from "@/components/ui/modal";

export function AuthModal({
  open,
  onClose,
  onDone,
  monthlyCredits,
  reason,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  monthlyCredits: number;
  reason?: string | null;
}) {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const switchMode = () => setMode((m) => (m === "signup" ? "login" : "signup"));

  return (
    <Modal open={open} onClose={onClose} title="Sua conta Mix Pro">
      {reason && <p className="mb-4 rounded-xl bg-primary/10 p-3 text-sm text-violet-200">{reason}</p>}
      {mode === "signup" ? (
        <SignupFields monthlyCredits={monthlyCredits} embedded={{ onDone, onSwitch: switchMode }} />
      ) : (
        <LoginFields embedded={{ onDone, onSwitch: switchMode }} />
      )}
    </Modal>
  );
}
