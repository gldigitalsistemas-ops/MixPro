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
        <li>
          As ferramentas do servidor (tom e andamento, voz + playback, masterização por referência, modo álbum, separação de faixas e
          relatório técnico) usam a quantidade de créditos mostrada antes de começar. Os créditos só são debitados quando o resultado fica
          pronto; se algo falhar ou você cancelar, nada é cobrado. A conversão de formato é grátis.
        </li>
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

      <h2>7-A. Produção (Mix & Master IA, Produção da composição, Voz finalizada, VS Premium)</h2>
      <ul className="list-disc pl-5">
        <li>
          São recursos novos, abertos a todos e marcados como “em desenvolvimento”: os resultados podem variar e continuam sendo
          melhorados. Antes de pagar, você ouve uma prévia grátis de 30 segundos (limite diário de prévias).
        </li>
        <li>
          O preço é o mostrado na tela antes do pagamento. O preço da <strong>1ª experiência</strong> vale uma única vez por pessoa e por
          recurso: contas, aparelhos ou CPFs repetidos para obter a oferta de novo não são aceitos, e a oferta pode ser negada nesses casos.
          No Plano Pro há o desconto informado na tela.
        </li>
        <li>
          Pagamento em reais (PIX ou cartão, pelo Mercado Pago) ou, onde indicado, em créditos. O trabalho completo começa assim que o
          pagamento é aprovado. Se algo der errado no processamento, refazemos ou devolvemos o valor.
        </li>
        <li>
          Na Mix & Master IA e na Voz finalizada, você pode pedir revisões com novos ajustes pelo prazo informado na tela (padrão: 7 dias
          após o pagamento). O “Engenheiro finaliza” é um serviço humano com prazo e revisões, como a Mixagem Profissional.
        </li>
        <li>
          Os arquivos ficam no seu Cofre por até 30 dias. Baixe e guarde as suas cópias.
        </li>
        <li>
          <strong>Direitos e IA:</strong> a composição, a voz e os arquivos que você envia continuam seus, e você declara ter os direitos
          sobre eles. Na Produção da composição, o arranjo é gerado com inteligência artificial a partir da sua composição: ao distribuir,
          informe o uso de IA, como as plataformas e distribuidoras exigem. A música de referência serve só para orientar o som; não envie
          material de terceiros para reproduzir ou copiar.
        </li>
        <li>
          <strong>Vitrine:</strong> se você autorizar, concede ao Mix Pro uma licença gratuita, não exclusiva e revogável para mostrar um
          trecho de até 30 segundos da sua produção na vitrine, para divulgação. A autorização é opcional e pode ser retirada a qualquer
          momento. O presente em créditos é creditado quando o trecho é aprovado.
        </li>
      </ul>

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
