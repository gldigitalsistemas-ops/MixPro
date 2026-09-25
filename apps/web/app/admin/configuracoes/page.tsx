import { supabaseServer } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { SettingRow } from "./setting-row";

export const metadata = { title: "Configurações" };

export default async function AdminSettings() {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("system_settings").select("key,value,description,is_public,updated_at").order("key");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Configurações do sistema</h1>
        <p className="text-sm text-muted">Regras comerciais e limites — nada fica fixo no código. Alterações valem imediatamente.</p>
      </div>
      <Card className="divide-y divide-border">
        {(data ?? []).map((s) => (
          <SettingRow key={s.key} k={s.key} value={s.value} description={s.description} />
        ))}
      </Card>
    </div>
  );
}
