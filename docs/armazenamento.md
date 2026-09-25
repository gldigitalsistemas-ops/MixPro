# Armazenamento: custo zero no início, sem risco para o usuário

## Decisão

| Dado | Onde fica | Por quê |
|---|---|---|
| Banco, login, regras | **Supabase Free** | 500 MB de banco bastam para milhares de usuários (só metadados). |
| Áudios | **Cloudflare R2** | 10 GB grátis por mês e **sem taxa de download** (egress). No Supabase Free o limite é 1 GB no total e 50 MB por arquivo. |
| Arquivos da Mixagem Profissional | **Seu PC** (sincronizados pelo worker) + nuvem temporária | Você recebe as pistas direto numa pasta, pronto para abrir no DAW. |

O código fala com **qualquer storage S3-compatível** (R2, MinIO, AWS S3, Backblaze B2, o próprio Supabase Storage). Trocar de provedor muda só as variáveis `S3_*`.

## Como o espaço é economizado (automático)

1. **WAV → FLAC sem perdas.** Ao analisar um upload WAV ou AIFF de 16 ou 24 bits, o worker converte para FLAC de forma bit-exata. Isso reduz de 40% a 60% do espaço. O usuário baixa sempre em WAV ou MP3.
2. **Previews são trechos de 30 s.** Não se processa a música inteira para testar presets.
3. **Cache por conteúdo.** Mesmo áudio + mesmo preset + mesma intensidade gera o mesmo arquivo. Nada é processado ou guardado duas vezes.
4. **Retenção configurável** (painel admin → Configurações):
   - `retention_preview_days` (padrão 7): previews sem acesso são apagados. Se o usuário voltar, o preview é gerado de novo em segundos.
   - `retention_render_days` (padrão 3): arquivos finais são apagados. Um novo download do mesmo resultado **é gerado de novo e não cobra outro crédito**.
   - Uploads abandonados são apagados após 24 h.
   - Projetos excluídos têm tudo apagado.
5. **O dispositivo do usuário é a cópia principal.** O usuário já tem o original (foi ele quem enviou) e o resultado baixado. A nuvem funciona como área de trabalho, não como backup eterno.

Estimativa: com 10 GB e os padrões acima, cabem folgadamente algumas centenas de usuários ativos por semana.

## Por que não guardar tudo só no celular ou no PC do usuário?

O processamento acontece no worker, então o arquivo **precisa** chegar até ele. Guardar só no aparelho do usuário:
- impediria processar enquanto o app estiver fechado;
- quebraria o A/B e o reprocessamento com outro preset;
- exigiria conexão direta aparelho→worker, que é inviável (NAT, 4G, firewall).

O que fazemos no lugar: **o original fica na nuvem só enquanto o projeto é usado**, e todo o resto é temporário e regenerável.

## Pedidos profissionais direto no seu PC (Fase 7)

O mesmo worker que roda no seu PC terá uma tarefa extra:
1. O pedido é pago e confirmado por webhook.
2. O worker baixa as pistas para `ORDERS_DIR\<data>_<cliente>_<projeto>\01_Voz.wav…`, já nomeadas e em ZIP se você preferir.
3. Ele confere a integridade (hash) e marca o pedido como "arquivos recebidos no estúdio".
4. **A cópia na nuvem continua lá até o pedido ser concluído**, mais N dias. Se o seu PC estiver desligado, com o HD cheio ou com defeito, nada se perde: o worker sincroniza quando voltar.

Riscos e cuidados:
- **O disco C: tem pouco espaço livre (~10 GB).** Configure `ORDERS_DIR` para outro disco ou HD externo.
- Um PC desligado não perde pedidos, apenas atrasa a sincronização.
- Faça backup da pasta de pedidos. A nuvem só guarda os arquivos até a entrega.

## Quando migrar para pago

- **R2 passando de 10 GB:** US$ 0,015 por GB/mês. 100 GB custam cerca de R$ 8/mês, ainda sem taxa de download.
- **Supabase:** o projeto Free pausa após 7 dias **sem nenhum acesso**. Com usuários reais isso não acontece. O Pro (US$ 25/mês) só é necessário com milhares de usuários ou para backups diários automáticos.
