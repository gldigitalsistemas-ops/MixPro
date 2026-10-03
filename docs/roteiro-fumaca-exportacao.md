# Roteiro manual de fumaça — exportação

Para seguir no navegador **antes** e **depois** da Etapa 2 do ExportJob. O objetivo é provar que a
exportação continua igual: mesmo som, mesma imagem, mesma duração e mesmo débito de crédito.

## Preparação (uma vez)

1. Crie duas pastas: `fumaca/antes` e `fumaca/depois`.
2. Use **sempre os mesmos arquivos de entrada**, sem copiar nem salvar de novo. O app reconhece o
   arquivo pelo nome, pelo tamanho e pela data de modificação.
   - Vídeo de voz: `Cantando.mp4` (na raiz do projeto).
   - Áudio: um arquivo seu de voz falada (WAV ou MP3, de 30 s a 2 min).
3. Use a mesma conta, o mesmo navegador (Chrome no computador) e o mesmo aparelho nas duas rodadas.
4. Para medir, instale programas gratuitos:
   - **Youlean Loudness Meter 2**, versão standalone. Arraste o arquivo: ele mostra o loudness
     integrado (LUFS) e o pico.
   - **Audacity**, para a duração exata e o "teste de nulo".
   - Alternativa, se um dia tiver o ffmpeg: `ffmpeg -i arquivo -af ebur128=peak=sample -f null -`
     mostra o I (LUFS) e o pico no fim. `ffprobe arquivo` mostra a duração e a resolução.
5. Em cada caso, **anote todas as configurações** numa tabela, para repetir igual depois: preset,
   intensidade, ruído, "Volume ideal para redes sociais", cortes, música, formato, legendas, imagem, selo e CTA.

> **WAV nunca sai idêntico byte a byte.** A gravação do WAV soma um ruído de dither sorteado em
> cada exportação, cerca de -96 dBFS. Duas exportações iguais diferem só nesse ruído. Por isso a
> comparação é pelo teste de nulo, e não pelo tamanho ou pelo "hash" do arquivo. MP3 e M4A também
> podem variar um pouco entre execuções do codificador do navegador; compare pelas medidas.

## (a) Áudio: WAV e MP3

1. Estúdio → **Enviar áudio** → escolha o arquivo de voz.
2. Aba **Som**:
   - escolha um preset de voz (ex.: "Voz de YouTuber") e a intensidade 75;
   - em Ruído, escolha **Reduzir**.
3. Aba **Baixar**:
   - deixe **Volume ideal para redes sociais** ligado;
   - **Gerar áudio pronto (MP3)** → salve em `fumaca/antes`;
   - depois **WAV** → salve também.
4. Repita uma vez com o **Volume ideal para redes sociais** desligado e salve só o WAV, com o nome `..._sem-redes.wav`.

**O que conferir em cada arquivo:**

| Item | Como medir | Esperado |
|---|---|---|
| Duração | Audacity (abrir; o tamanho aparece na barra de seleção) | igual à do original (sem cortes) |
| Loudness | Youlean: Integrated | ≈ -14 LUFS (±0,5) com redes ligado |
| Pico | Youlean: pico de amostra | ≤ -1 dBFS com redes ligado |
| Som | ouvir com fone | sem estalos, cortes ou eco estranho |

**Antes x depois:**
- Duração: idêntica, até a amostra.
- LUFS e pico: diferença de no máximo 0,01 dB. No WAV, só o dither muda.
- **Teste de nulo (WAV):**
  1. No Audacity, abra os dois WAVs (antes e depois).
  2. Selecione a faixa "depois" → Efeito → **Inverter**.
  3. Selecione tudo → Faixas → **Misturar e renderizar**.
  4. O resultado deve ser praticamente silêncio: só um chiado abaixo de -85 dBFS. Confira em
     Efeito → Amplificar, no valor que ele sugere (deve ficar acima de +80 dB), ou exporte o
     resultado e meça no Youlean.
  5. Qualquer som audível (voz, batidas) é diferença real: **reprovado**.
- **Crédito:** baixar de novo, depois da Etapa 2, o mesmo resultado com as mesmas configurações
  **não pode gastar crédito**. O app avisa "Baixar de novo o mesmo resultado não gasta crédito".
  Confira o saldo antes e depois. Se debitar, a chave do resultado mudou: **reprovado**.

## (b) Vídeo só trocando o áudio (sem recodificar a imagem)

1. Estúdio → **Enviar vídeo** → `Cantando.mp4`.
2. Aba **Som**: preset de voz, intensidade 75, ruído **Reduzir**. Na aba Baixar, **Volume ideal para redes sociais** ligado.
3. Aba **Vídeo**:
   - Cortar pausas: **Sem cortes**;
   - Formato: **Original**;
   - Selo "Feito com Mix Pro": **desligado**;
   - Imagem: desmarque **Correção automática**, filtro **Natural**, Nitidez **0**, Vinheta **0**;
   - sem CTA e sem "antes e depois".
4. Aba **Legendas**: não gere legendas.
5. Aba **Baixar** → **Gerar vídeo pronto para postar**.
   - Durante a geração, o texto deve ser **"Montando o vídeo com o som novo…"** (caminho rápido).
   - Se aparecer "Montando o vídeo quadro a quadro…", alguma opção ficou ligada: refaça o passo 3.

**O que conferir:**
- Resolução e duração iguais às do original (Propriedades → Detalhes no Windows, ou `ffprobe`).
- A imagem idêntica à do original: sem mudança de cor e sem selo.
- O som tratado e em sincronia com a boca, do começo ao fim.
- O loudness do vídeo ≈ -14 LUFS (o Youlean aceita MP4).

**Antes x depois:**
- O texto da etapa ("com o som novo") deve ser o mesmo. Se o caminho mudar para "quadro a quadro",
  houve regressão na decisão de recodificar.
- Duração e resolução idênticas, e o tamanho do arquivo praticamente igual (a imagem é copiada).
- O LUFS e o pico com diferença de no máximo 0,01 dB.
- Sincronia: pare nos mesmos 3 instantes (ex.: 0:05, metade e 5 s antes do fim) nos dois arquivos.
  Boca e som devem coincidir igualmente.
- Crédito: não debita de novo (como no item a).

## (c) Vídeo renderizado: 9:16, legendas, cor e CTA

1. Mesmo vídeo e mesmo som do item (b).
2. Aba **Legendas** → **Gerar legendas automáticas**.
   - Escolha um estilo (ex.: "Destaque") e a posição (embaixo).
   - Corrija uma palavra à mão, para testar a edição.
   - Anote 3 frases e o instante de cada uma.
3. Aba **Vídeo**:
   - Formato **9:16**, enquadramento **Fundo desfocado**;
   - Imagem: correção automática ligada e filtro **Vibrante**;
   - Cortar pausas: **Suave**;
   - **Chamada no final (CTA)**: escolha uma sugestão e preencha o @;
   - Selo: como preferir (anote).
4. Aba **Baixar** → **Gerar vídeo pronto para postar** ("Montando o vídeo quadro a quadro…").

**O que conferir:**
- Resolução **1080×1920**.
- A duração **menor** que a do original (pausas cortadas). O resumo antes do botão mostra "X de
  pausas cortadas": anote esse valor.
- Legendas:
  - cada frase anotada aparece **no momento em que é falada**, inclusive depois dos cortes;
  - a palavra corrigida aparece corrigida;
  - o estilo e a posição estão certos.
- Cor: com o tom do filtro Vibrante; o CTA aparece nos últimos ~3,5 s, com o texto e o @ certos.
- Sem quadros pretos ou congelados nas emendas dos cortes; o som sem estalos nas emendas.
- Loudness ≈ -14 LUFS.

**Antes x depois:**
- A resolução e a duração idênticas (a duração até o quadro, por exemplo pela barra do player do Windows com o
  vídeo pausado no último quadro, ou pelo `ffprobe`).
- Abra os dois vídeos lado a lado e pare nos mesmos 4 instantes (início, uma emenda de corte, uma
  legenda e o CTA). A imagem, a legenda e o CTA devem ser iguais à vista. Diferenças mínimas de
  compressão são normais; mudanças de cor, de posição ou de texto não são.
- As legendas aparecem nos mesmos instantes, com no máximo 1 quadro de diferença.
- O LUFS e o pico com diferença de no máximo 0,01 dB.
- Crédito: não debita de novo.

## Registro

Para cada item (a, b, c), anote: data, commit testado, configurações, duração, LUFS, pico, o
resultado do teste de nulo (só no WAV), se o crédito foi debitado e **aprovado/reprovado**.
Guarde os arquivos de `fumaca/antes` até a Etapa 2 ser aprovada.
