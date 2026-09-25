import Link from "next/link";
import { requireSession, supabaseAdmin } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Mic, Waves, Sparkles, ChevronRight } from "lucide-react";

export const metadata = { title: "AI Audio Lab" };

type Feature = {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  settingKey: string;
  href: string;
  creditsKey?: string;
};

const FEATURES: Feature[] = [
  {
    id: "stem",
    title: "Separação de Stems",
    description: "Separe um mix em vocais, bateria, baixo e outros instrumentos usando IA de última geração.",
    icon: Waves,
    settingKey: "ai_lab_stem_enabled",
    creditsKey: "ai_lab_stem_credits",
    href: "/app/lab/separar",
  },
  {
    id: "denoise",
    title: "Redução de Ruído IA",
    description: "Remova ruídos de fundo, ventiladores, frisos e outros indesejados de qualquer gravação.",
    icon: Mic,
    settingKey: "ai_lab_denoise_enabled",
    creditsKey: "ai_lab_denoise_credits",
    href: "/app/lab/denoise",
  },
  {
    id: "master",
    title: "Masterização Assistida por IA",
    description: "Analise sua mixagem e receba sugestões automáticas de presets baseadas no estilo da sua faixa.",
    icon: Sparkles,
    settingKey: "ai_lab_master_enabled",
    href: "/app/lab/master",
  },
];

export default async function AILabPage() {
  await requireSession("/app/lab");
  const admin = supabaseAdmin();

  const { data: settings } = await admin.from("system_settings").select("key,value").in("key", [
    "ai_lab_enabled",
    "ai_lab_stem_enabled",
    "ai_lab_denoise_enabled",
    "ai_lab_master_enabled",
    "ai_lab_stem_credits",
    "ai_lab_denoise_credits",
  ]);
  const s = Object.fromEntries((settings ?? []).map((r) => [r.key, r.value]));
  const labEnabled = s["ai_lab_enabled"] === true || s["ai_lab_enabled"] === "true";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-semibold">AI Audio Lab</h1>
          <Badge tone="primary">Beta</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">
          Ferramentas experimentais de inteligência artificial para produção e pós-produção de áudio.
        </p>
      </div>

      {!labEnabled && (
        <Card className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl">🧪</div>
          <div>
            <p className="font-medium">AI Lab em preparação</p>
            <p className="mt-1 text-sm text-muted max-w-sm">
              Estamos finalizando a infraestrutura de IA. Em breve você poderá separar stems, remover ruídos e muito mais.
            </p>
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ id, title, description, icon: Icon, settingKey, creditsKey, href }) => {
          const enabled = labEnabled && (s[settingKey] === true || s[settingKey] === "true");
          const credits = creditsKey ? Number(s[creditsKey] ?? 0) : 0;
          return (
            <Card key={id} className="flex flex-col gap-4 p-6">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15">
                  <Icon className="size-5 text-violet-300" aria-hidden />
                </div>
                <div className="flex items-center gap-2">
                  <h2 className="font-medium">{title}</h2>
                  {!enabled && <Badge tone="neutral">Em breve</Badge>}
                  {enabled && credits > 0 && <Badge tone="info">{credits} crédito{credits !== 1 ? "s" : ""}</Badge>}
                </div>
              </div>
              <p className="text-sm text-muted flex-1">{description}</p>
              {enabled ? (
                <ButtonLink href={href} size="sm" className="w-full">
                  Usar agora <ChevronRight className="size-4" aria-hidden />
                </ButtonLink>
              ) : (
                <button disabled className="flex h-9 w-full items-center justify-center rounded-full bg-white/6 text-xs text-subtle">
                  Em breve
                </button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
