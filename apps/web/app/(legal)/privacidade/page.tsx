export const metadata = { title: "Política de privacidade" };

export default function Privacy() {
  return (
    <>
      <h1>Política de privacidade</h1>
      <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-amber-200">
        Rascunho técnico: revise este texto com um profissional jurídico antes da publicação (LGPD).
      </p>
      <h2>Seus áudios são privados</h2>
      <p>
        Os arquivos que você envia ficam em armazenamento privado e só podem ser acessados por você, por meio de links temporários. Não
        publicamos, vendemos ou compartilhamos suas gravações.
      </p>
      <h2>Não treinamos IA com seus áudios</h2>
      <p>Suas gravações não são usadas para treinar modelos de inteligência artificial.</p>
      <h2>Retenção</h2>
      <p>
        Previews e arquivos processados são apagados automaticamente após alguns dias sem uso e podem ser gerados novamente a qualquer
        momento, sem nova cobrança para downloads já pagos. Ao excluir um projeto, o áudio original e todos os resultados são apagados.
      </p>
      <h2>Dados coletados</h2>
      <p>
        Coletamos nome, e-mail e registros de uso (como presets testados e downloads) para operar o serviço, prevenir fraudes e melhorar
        a experiência.
      </p>
    </>
  );
}
