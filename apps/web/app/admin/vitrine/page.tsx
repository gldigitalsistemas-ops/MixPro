import { requireAdmin, supabaseAdmin } from "@/lib/supabase/server";
import { R2Client, r2ConfigFromEnv } from "@/lib/export/r2";
import { formatDateTime } from "@/lib/cn";
import { AdminShowcase, AdminShowcaseCreate, type AdminItem } from "@/components/premium/admin-showcase";

export const metadata = { title: "Vitrine" };
export const dynamic = "force-dynamic";

/** Vitrine: autorizações dos usuários para aprovar e exemplos próprios. */
export default async function AdminVitrine() {
  await requireAdmin();
  const admin = supabaseAdmin();
  const [{ data }, { data: authList }] = await Promise.all([
    admin.from("showcase_items").select("*").order("status").order("created_at", { ascending: false }).limit(200),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  const emails = new Map((authList?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  let r2: R2Client | null = null;
  try {
    r2 = new R2Client(r2ConfigFromEnv());
  } catch {}
  const items: AdminItem[] = (data ?? []).map((r) => ({
    id: r.id,
    product: r.product,
    genre: r.genre,
    title: r.title,
    artist: r.anonymous ? null : r.artist_name,
    owner: r.user_id ? (emails.get(r.user_id) ?? "usuário") : "exemplo do admin",
    status: r.status,
    featured: r.featured,
    plays: r.plays,
    reward: r.reward_credits,
    before: r.before_key && r2 ? r2.presign("GET", r.before_key, 3600) : null,
    after: r2 ? r2.presign("GET", r.after_key, 3600) : "",
    created: formatDateTime(r.created_at),
  }));
  const pending = items.filter((i) => i.status === "pending").length;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Vitrine</h1>
        <p className="text-sm text-muted">
          Trechos de antes e depois que aparecem na página inicial e em cada módulo. Só entram com autorização de quem fez (e a aprovação aqui). {pending} aguardando.
        </p>
      </div>
      <AdminShowcaseCreate />
      <AdminShowcase items={items} />
    </div>
  );
}
