# Arquitetura do Mix Pro

O Mix Pro transforma uma gravação comum em um áudio mais profissional: **enviar → analisar → processar → ouvir → baixar**. O produto é só tratamento, mixagem e masterização de áudio. O vídeo existe apenas para a pessoa não precisar extrair o áudio, e o VS (separação de stems) é o módulo avançado.

## Quem faz o quê

```
 Navegador (Vercel)                        Servidor (opcional, por conta)
 ┌──────────────────────────────┐          ┌───────────────────────────────────────────┐
 │ interface, player A/B, upload│  job     │ rotas /api/export/jobs  (Vercel)          │
 │ análise e diagnóstico        │ ───────► │   valida · reserva crédito · URL assinada │
 │ prévia (DSP em Web Worker)   │          │ R2 privado  ◄── upload direto da trilha   │
 │ troca do áudio do vídeo      │ ◄─────── │ Cloud Tasks ──► Cloud Run (serviço)       │
 │ (remux, sem recodificar)     │ download │   FFmpeg + o mesmo DSP do app             │
 └──────────────────────────────┘          │ Supabase: estado, crédito, Realtime       │
        ▲ caminho padrão e fallback        └───────────────────────────────────────────┘
```

- **Aparelho (padrão e fallback).** A prévia, o diagnóstico e a exportação rodam no navegador com o motor DSP em TypeScript. É o caminho de quem não tem o servidor liberado e a rede de segurança de quem tem: qualquer recusa ou falha do servidor cai aqui, com uma frase amigável.
- **Servidor (liberado por conta).** O mesmo código do DSP roda em Node, no Cloud Run, com FFmpeg para decodificar e codificar. O navegador envia **só a trilha de áudio** (~1 MB por minuto); o servidor devolve só o áudio tratado. Em vídeo, a troca do áudio é feita no aparelho, **sem recodificar a imagem** (os pacotes de vídeo ficam idênticos).
- **Supabase.** Auth, Postgres (RLS), créditos e o estado dos jobs. Realtime fica pronto na tabela de status, mas a interface hoje acompanha por consulta (1,5 s, depois 3 s).

## Por que o DSP não foi reescrito

O motor de `apps/web/lib/dsp` já é código isomórfico: o mesmo `processAudio` roda no Web Worker do navegador e no Node do serviço, com a decodificação do servidor medida contra a do Chrome (paridade). Reescrever para uma estrutura nova só traria risco para a bateria (detecção e samples), os amplificadores e as IRs. Veja [AUDIO_ENGINE.md](AUDIO_ENGINE.md).

## Fluxo de um job no servidor

1. `POST /api/export/jobs`: valida o pedido (schema estrito e `p_ref` recalculado), limita o tamanho, **reserva** 1 crédito e devolve uma URL de envio para o R2 com o tamanho assinado.
2. O navegador envia a trilha direto ao R2 (progresso real) e chama `POST …/start`.
3. A rota confere que o arquivo chegou e cria a tarefa no Cloud Tasks (o nome da tarefa leva o id do job: repetir não duplica).
4. O Cloud Tasks chama `POST /run` no Cloud Run com token OIDC. O serviço lê o job do banco, decodifica em fluxo, processa, grava a saída no R2 e **debita** o crédito na mesma transação que marca o job como pronto.
5. O navegador acompanha o status, baixa por URL assinada de 60 s e (em vídeo) junta ao vídeo original.

Detalhes de estados, créditos e erros: [PROCESSING_JOBS.md](PROCESSING_JOBS.md). Execução do serviço: [WORKER.md](WORKER.md). Implantação: [DEPLOYMENT.md](DEPLOYMENT.md).

## Princípios

1. **Estabilidade primeiro.** O servidor nasce desligado (`export_server_enabled = false`) e é liberado por conta (`export_server_users`). Desligar devolve o app exatamente ao comportamento anterior.
2. **Nada de progresso ou métrica inventada.** Todo número mostrado (LUFS, true peak, LRA, ruído de fundo, pico) é calculado do sinal; o progresso do servidor é o que o serviço grava.
3. **Nunca confiar no cliente.** Schema estrito, `p_ref` recalculado, dono conferido em toda rota, chaves de armazenamento aleatórias, `service_role` só no servidor.
4. **Privacidade.** O nome do arquivo nunca sobe; o JSON do job é apagado quando termina; os arquivos somem do R2 em 24 h.
5. **Custo perto de zero.** Cloud Run escala a zero, 2 jobs em paralelo, tetos diários de CPU e de jobs no banco.

## Escopo (o que não existe de propósito)

Edição de vídeo, cortes, filtros, legendas, transcrição, thumbnails e IA de imagem não fazem parte do produto. O código antigo dessas funções continua no repositório até a remoção planejada (depois da fusão desta branch na `main`), mas sai do caminho principal. O VS segue no navegador (Demucs via ONNX); a arquitetura para movê-lo para GPU está descrita em [PROCESSING_JOBS.md](PROCESSING_JOBS.md#vs-preparação).
