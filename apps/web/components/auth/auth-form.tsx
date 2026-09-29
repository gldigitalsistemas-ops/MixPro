"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/public-env";
import { Button } from "@/components/ui/button";
import { REF_STORAGE_KEY } from "@/lib/account";

const inputCls =
  "h-12 w-full rounded-xl border border-border-strong bg-black/20 px-4 text-sm outline-none transition placeholder:text-subtle focus:border-violet-400";

function translate(msg: string): string {
  if (/invalid login/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(msg)) return "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.";
  if (/already registered|already been registered/i.test(msg)) return "Este e-mail já tem cadastro. Tente entrar.";
  if (/password should be at least/i.test(msg)) return "A senha precisa ter pelo menos 8 caracteres.";
  if (/rate limit/i.test(msg)) return "Muitas tentativas. Aguarde alguns minutos.";
  return "Não foi possível concluir. Tente novamente.";
}

function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function storedRef(): string | null {
  try {
    const v = localStorage.getItem(REF_STORAGE_KEY);
    return v && /^[A-Z0-9]{4,12}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Dentro de uma janela no estúdio: não navega, só avisa quando terminar. */
export type Embedded = { onDone: () => void; onSwitch: () => void };

export function LoginFields({
  next,
  linkError,
  embedded,
}: {
  next?: string | null;
  linkError?: boolean;
  embedded?: Embedded;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
    });
    setLoading(false);
    if (error) return setError(translate(error.message));
    if (embedded) return embedded.onDone();
    router.replace(safeNext(next));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div>
        <h1 className="font-display text-2xl font-semibold">Entrar</h1>
        <p className="mt-1 text-sm text-muted">Continue de onde parou.</p>
      </div>
      {linkError && <p className="rounded-xl bg-danger/10 p-3 text-sm text-red-300">O link expirou ou é inválido.</p>}
      <label className="flex flex-col gap-1.5 text-sm">
        E-mail
        <input name="email" type="email" autoComplete="email" required className={inputCls} placeholder="voce@email.com" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Senha
        <input name="password" type="password" autoComplete="current-password" required className={inputCls} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" loading={loading}>
        Entrar
      </Button>
      <div className="flex justify-between text-sm">
        <Link href="/recuperar-senha" className="text-muted hover:text-text">
          Esqueci a senha
        </Link>
        {embedded ? (
          <button type="button" onClick={embedded.onSwitch} className="text-violet-300 hover:text-violet-200">
            Criar conta grátis
          </button>
        ) : (
          <Link
            href={`/cadastro${next ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="text-violet-300 hover:text-violet-200"
          >
            Criar conta grátis
          </Link>
        )}
      </div>
    </form>
  );
}

export function LoginForm() {
  const params = useSearchParams();
  return <LoginFields next={params.get("next")} linkError={Boolean(params.get("erro"))} />;
}

export function SignupFields({
  monthlyCredits,
  next,
  refCode,
  embedded,
}: {
  monthlyCredits: number;
  next?: string | null;
  refCode?: string | null;
  embedded?: Embedded;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (!form.get("terms")) return setError("Aceite os termos para continuar.");
    setLoading(true);
    setError(null);
    const email = String(form.get("email")).trim();
    const ref = refCode ?? storedRef();
    const { data, error } = await supabaseBrowser().auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: String(form.get("name")).trim(),
          ...(ref ? { referral_code: ref } : {}),
        },
        emailRedirectTo: `${publicEnv.appUrl}/auth/callback?next=${encodeURIComponent(safeNext(next))}`,
      },
    });
    setLoading(false);
    if (error) return setError(translate(error.message));
    if (data.session) {
      if (embedded) return embedded.onDone();
      router.replace(safeNext(next));
      router.refresh();
    } else {
      setSentTo(email);
    }
  }

  /** O link de confirmação abre em outra aba; a sessão fica nos cookies, que esta aba também lê. */
  async function checkConfirmed() {
    setChecking(true);
    setError(null);
    const { data } = await supabaseBrowser().auth.getSession();
    setChecking(false);
    if (data.session) embedded?.onDone();
    else setError("Ainda não encontramos a confirmação. Toque no link do e-mail e tente de novo.");
  }

  if (sentTo) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <MailCheck className="size-10 text-violet-300" aria-hidden />
        <h1 className="font-display text-xl font-semibold">Confirme seu e-mail</h1>
        <p className="text-sm text-muted">
          Enviamos um link para <strong className="text-text">{sentTo}</strong>. Toque nele para ativar sua conta e
          receber {monthlyCredits} downloads grátis por mês.
        </p>
        {embedded && (
          <>
            <Button size="lg" className="w-full" loading={checking} onClick={checkConfirmed}>
              Já confirmei
            </Button>
            {error && <p className="text-sm text-red-300">{error}</p>}
          </>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div>
        <h1 className="font-display text-2xl font-semibold">Criar conta grátis</h1>
        <p className="mt-1 text-sm text-muted">
          {monthlyCredits} downloads grátis todo mês. Ouvir e testar presets é ilimitado.
        </p>
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        Nome
        <input name="name" autoComplete="name" required maxLength={60} className={inputCls} placeholder="Como quer ser chamado" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        E-mail
        <input name="email" type="email" autoComplete="email" required className={inputCls} placeholder="voce@email.com" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Senha
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className={inputCls}
          placeholder="Mínimo 8 caracteres"
        />
      </label>
      <label className="flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" name="terms" className="mt-0.5 accent-violet-500" />
        <span>
          Li e aceito os <Link href="/termos" className="underline">termos de uso</Link> e a{" "}
          <Link href="/privacidade" className="underline">política de privacidade</Link>. Declaro possuir os direitos sobre os
          arquivos que usar.
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" loading={loading}>
        Criar conta grátis
      </Button>
      <p className="text-center text-sm text-muted">
        Já tem conta?{" "}
        {embedded ? (
          <button type="button" onClick={embedded.onSwitch} className="text-violet-300">
            Entrar
          </button>
        ) : (
          <Link href="/entrar" className="text-violet-300">
            Entrar
          </Link>
        )}
      </p>
    </form>
  );
}

export function SignupForm({ monthlyCredits }: { monthlyCredits: number }) {
  const params = useSearchParams();
  return <SignupFields monthlyCredits={monthlyCredits} next={params.get("next")} refCode={params.get("ref")} />;
}

export function RecoverForm() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    await supabaseBrowser().auth.resetPasswordForEmail(String(new FormData(e.currentTarget).get("email")), {
      redirectTo: `${publicEnv.appUrl}/auth/callback?next=/nova-senha`,
    });
    setLoading(false);
    setSent(true); // Mesma resposta sempre (não revela se o e-mail existe)
  }
  if (sent)
    return (
      <p className="text-center text-sm text-muted">
        Se houver uma conta com esse e-mail, você receberá um link para criar uma nova senha.
      </p>
    );
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold">Recuperar senha</h1>
      <label className="flex flex-col gap-1.5 text-sm">
        E-mail
        <input name="email" type="email" required autoComplete="email" className={inputCls} />
      </label>
      <Button type="submit" size="lg" loading={loading}>
        Enviar link
      </Button>
    </form>
  );
}

export function NewPasswordForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    setLoading(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(translate(error.message));
    router.replace("/");
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold">Nova senha</h1>
      <label className="flex flex-col gap-1.5 text-sm">
        Nova senha
        <input name="password" type="password" minLength={8} required autoComplete="new-password" className={inputCls} />
      </label>
      {error && <p className="text-sm text-red-300">{error}</p>}
      <Button type="submit" size="lg" loading={loading}>
        Salvar
      </Button>
    </form>
  );
}
