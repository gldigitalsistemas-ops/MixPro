-- =============================================================================
-- Mix Pro — Horário de Brasília (America/Sao_Paulo, UTC-3) no banco.
-- As datas continuam gravadas com fuso (timestamptz); muda só como o banco interpreta "hoje",
-- "início do mês" e "dia": créditos e limites mensais, indicações do mês e o resumo diário do
-- registro de uso passam a virar à meia-noite de Brasília, não às 21h (UTC).
-- Os agendamentos (pg_cron) continuam em UTC: a limpeza das 06h UTC roda às 03h de Brasília.
-- Pode rodar mais de uma vez.
-- =============================================================================

alter database postgres set timezone to 'America/Sao_Paulo';
-- também nos papéis usados pelo app (se o Supabase não permitir algum, segue sem ele)
do $$
declare r text;
begin
  foreach r in array array['authenticated', 'anon', 'service_role', 'authenticator'] loop
    begin
      execute format('alter role %I set timezone to %L', r, 'America/Sao_Paulo');
    exception when others then
      raise notice 'fuso não ajustado no papel %: %', r, sqlerrm;
    end;
  end loop;
end $$;

-- vale já para esta sessão (as novas conexões pegam a configuração acima)
set timezone to 'America/Sao_Paulo';
