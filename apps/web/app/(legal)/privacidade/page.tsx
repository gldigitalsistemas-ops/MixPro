import Link from "next/link";
import { BusinessBlock } from "@/components/layout/business-block";

export const metadata = { title: "Política de privacidade" };
export const revalidate = 3600;

export default function Privacy() {
  return (
    <>
      <h1>Política de privacidade</h1>
      <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-amber-200">
        Texto base conforme a LGPD (Lei 13.709/2018), descrevendo o que o app realmente faz. Revise com um profissional jurídico.
      </p>
      <p>Última atualização: 1º de outubro de 2026.</p>

      <h2>Controlador dos dados</h2>
      <BusinessBlock />

      <h2>Seus vídeos e áudios não saem do seu aparelho</h2>
      <p>
        O tratamento do som, as legendas automáticas (a inteligência artificial é baixada e roda no seu aparelho) e a montagem do vídeo
        acontecem no seu navegador. Não recebemos, não guardamos e não usamos suas gravações para treinar inteligência artificial. A única
        exceção é a Mixagem Profissional, em que você mesmo envia um link para os arquivos.
      </p>

      <h2>Dados que coletamos e por quê</h2>
      <ul className="list-disc pl-5">
        <li>
          <strong>Conta:</strong> e-mail, nome (se informado) e senha protegida — para login e atendimento (execução do contrato).
        </li>
        <li>
          <strong>Créditos e pagamentos:</strong> histórico de créditos, pedidos e status de pagamento. Os dados de pagamento (cartão, PIX)
          ficam com o Mercado Pago; guardamos os registros das compras pelo prazo exigido por lei (obrigação legal).
        </li>
        <li>
          <strong>Preferências salvas:</strong> presets favoritos, “Meus presets”, estilos e kits desbloqueados — para você usar em qualquer
          aparelho.
        </li>
        <li>
          <strong>Registros de uso:</strong> ações como abrir o estúdio, gerar legendas e baixar (sem o conteúdo dos arquivos) — para medir
          e melhorar o app e prevenir fraudes (legítimo interesse). O detalhe fica guardado por 90 dias; depois vira um resumo diário sem
          identificação.
        </li>
        <li>
          <strong>No seu navegador:</strong> cookies de sessão (necessários para o login) e armazenamento local para preferências e o
          código de indicação. Não usamos cookies de publicidade.
        </li>
      </ul>

      <h2>Com quem os dados são compartilhados</h2>
      <p>
        Apenas com os serviços que fazem o app funcionar: Supabase (banco de dados e login), Vercel (hospedagem do site) e Mercado Pago
        (pagamentos). Os modelos de inteligência artificial das legendas são baixados de um repositório público, sem envio dos seus dados.
        Alguns desses serviços podem armazenar dados fora do Brasil, com as garantias previstas na LGPD. Não vendemos dados.
      </p>

      <h2>Seus direitos</h2>
      <p>
        Você pode pedir acesso, correção, portabilidade ou exclusão dos seus dados, e revogar consentimentos, pelo atendimento acima. A
        exclusão da conta também pode ser feita por você mesmo na página{" "}
        <Link href="/conta" className="text-violet-200 underline">
          Conta
        </Link>
        : ela apaga seus dados pessoais, presets e preferências; os registros de pagamento são mantidos, sem uso comercial, pelo prazo legal.
      </p>

      <h2>Segurança e menores</h2>
      <p>
        Usamos conexão criptografada, controle de acesso por usuário no banco de dados e senhas protegidas. Menores de 18 anos devem usar o
        app com autorização dos responsáveis, que são responsáveis por eventuais compras.
      </p>
    </>
  );
}
