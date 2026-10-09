import { BusinessBlock } from "@/components/layout/business-block";

export const metadata = { title: "Termos de uso" };
export const revalidate = 3600;

export default function Terms() {
  return (
    <>
      <h1>Termos de uso</h1>
      <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-amber-200">
        Texto base que descreve como o Mix Pro funciona. Revise com um profissional jurídico antes de começar a vender.
      </p>
      <p>Última atualização: 1º de outubro de 2026.</p>

      <h2>1. Quem oferece o serviço</h2>
      <BusinessBlock />

      <h2>2. O serviço</h2>
      <p>
        O Mix Pro trata, mixa e masteriza o áudio de gravações e vídeos (presets de mixagem, remoção de ruído, bateria de estúdio,
        amplificadores, masterização e outros recursos). O processamento acontece no seu aparelho ou, quando disponível, nos nossos
        servidores: nesse caso enviamos só o áudio, que é apagado automaticamente em até 24 horas. O resultado depende da qualidade da gravação original e do aparelho usado; não garantimos um resultado
        específico. Ouça sempre a prévia antes de baixar.
      </p>

      <h2>3. Conta</h2>
      <p>
        Testar e ouvir é livre. Para baixar resultados é preciso criar uma conta com e-mail válido. Você é responsável pela segurança da sua
        senha. Podemos suspender contas usadas para fraude, abuso ou violação destes termos.
      </p>

      <h2>4. Créditos e preços</h2>
      <ul className="list-disc pl-5">
        <li>Cada download de um resultado novo usa 1 crédito. Baixar de novo o mesmo resultado não gasta outro crédito.</li>
        <li>Contas novas recebem créditos grátis de boas-vindas, na quantidade informada na tela de cadastro.</li>
        <li>
          Créditos são comprados pelo Mercado Pago (PIX, cartão ou boleto), pelo preço exibido na tela de compra antes do pagamento. Não
          guardamos dados de cartão.
        </li>
        <li>Os créditos não expiram enquanto a conta existir e não podem ser convertidos em dinheiro nem transferidos para outra conta.</li>
        <li>Recursos premium (como kits de bateria premium) são desbloqueados com créditos, de forma permanente na sua conta.</li>
      </ul>

      <h2>5. Direito de arrependimento e reembolso</h2>
      <p>
        Você pode desistir de uma compra de créditos em até 7 dias da data do pagamento (art. 49 do Código de Defesa do Consumidor) e receber
        de volta o valor dos créditos ainda não utilizados, pelo mesmo meio de pagamento. Basta falar com o atendimento. Créditos já
        utilizados em downloads correspondem a um serviço já prestado. Se um pagamento for estornado ou contestado no cartão, os créditos
        daquela compra que ainda estiverem na conta são retirados.
      </p>

      <h2>6. Plano Criador (assinatura mensal)</h2>
      <p>
        O plano é cobrado todo mês no Mercado Pago, no valor informado na assinatura, e a cada cobrança aprovada os créditos do plano entram
        na sua conta. Você pode cancelar a qualquer momento na página Créditos: o cancelamento impede as próximas cobranças e os créditos já
        recebidos continuam seus. Aplica-se o direito de arrependimento de 7 dias à primeira cobrança, para os créditos não utilizados.
      </p>

      <h2>7. Mixagem profissional</h2>
      <p>
        Serviço feito por um engenheiro de áudio, pago antecipadamente, com prazo e número de revisões informados na página do serviço. Os
        arquivos são enviados por um link seu (Google Drive, WeTransfer e similares). Se você cancelar antes de o trabalho começar,
        devolvemos o valor integral.
      </p>

      <h2>8. Indicação de amigos</h2>
      <p>
        Quem indica e quem foi indicado recebem créditos de bônus quando a pessoa indicada faz a primeira compra aprovada, com limite mensal
        de indicações premiadas. Bônus obtidos por fraude (contas falsas, autoindicação) são cancelados.
      </p>

      <h2>9. Seu conteúdo e presets compartilhados</h2>
      <p>
        Você declara ter os direitos sobre os arquivos que usa no app. Ao compartilhar um preset por link, qualquer pessoa com o link pode
        ouvir e usar esse preset, e o seu primeiro nome aparece como autor. Os samples de bateria, caixas de amplificador e presets do Mix
        Pro são licenciados para uso dentro do app e nos resultados que você baixa; não é permitido extraí-los ou redistribuí-los.
      </p>

      <h2>10. Uso proibido</h2>
      <p>
        Não use o Mix Pro para conteúdo ilegal, que viole direitos autorais de terceiros, ou para tentar burlar a cobrança, acessar dados
        de outras pessoas ou prejudicar o funcionamento do serviço.
      </p>

      <h2>11. Responsabilidade e disponibilidade</h2>
      <p>
        Trabalhamos para manter o serviço disponível e correto, mas ele pode passar por interrupções e depende do navegador e do aparelho
        do usuário. Guarde sempre o seu arquivo original. Nossa responsabilidade se limita, no máximo, ao valor pago pelo serviço em
        questão, sem prejuízo dos direitos previstos no Código de Defesa do Consumidor.
      </p>

      <h2>12. Alterações e foro</h2>
      <p>
        Podemos atualizar estes termos; mudanças importantes serão avisadas no app. Fica eleito o foro do domicílio do consumidor para
        resolver eventuais conflitos.
      </p>
    </>
  );
}
