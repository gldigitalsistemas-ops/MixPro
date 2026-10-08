/**
 * Fila de jobs de exportação, atrás de uma interface: o app não conhece a tecnologia da fila.
 * Hoje: Cloud Tasks (entrega por HTTP: "push") em produção e uma fila em memória para
 * desenvolvimento e testes. Amanhã: Redis/BullMQ/Upstash, trocando só a implementação.
 *
 * `push`: a fila entrega o job ao serviço por HTTP; o ack é o 2xx da resposta e a falha/retentativa
 * é o 5xx (as operações de consumo não se aplicam e lançam QueueModeError).
 * `pull`: um consumidor chama dequeue/ack/fail/retry.
 */
export type QueueMessage = { id: string; jobId: string; attempts: number };

export interface QueueService {
  readonly mode: "push" | "pull";
  /** Enfileira o job. Chamar duas vezes com o mesmo jobId não duplica a tarefa. */
  enqueue(jobId: string): Promise<{ id: string }>;
  /** Pega a próxima mensagem disponível (só `pull`). */
  dequeue(): Promise<QueueMessage | null>;
  /** Terminou com sucesso: remove da fila. */
  ack(id: string): Promise<void>;
  /** Falha: com `retryable` e tentativas sobrando volta para a fila; senão vai para as mortas. */
  fail(id: string, retryable: boolean): Promise<"requeued" | "dead">;
  /** Devolve à fila uma mensagem que estava em andamento ou morta. */
  retry(id: string): Promise<void>;
}

export class QueueModeError extends Error {
  constructor(op: string) {
    super(`${op} não se aplica a uma fila de entrega por HTTP (push)`);
  }
}

/** Fila em memória (um processo): desenvolvimento e testes. Implementa todas as operações. */
export class LocalQueue implements QueueService {
  readonly mode = "pull" as const;
  private ready: QueueMessage[] = [];
  private running = new Map<string, QueueMessage>();
  private dead = new Map<string, QueueMessage>();
  private byJob = new Map<string, string>();
  private seq = 0;
  constructor(private maxAttempts = 3) {}

  async enqueue(jobId: string) {
    const existing = this.byJob.get(jobId);
    if (existing) return { id: existing };
    const id = `m${++this.seq}`;
    this.byJob.set(jobId, id);
    this.ready.push({ id, jobId, attempts: 0 });
    return { id };
  }

  async dequeue() {
    const m = this.ready.shift();
    if (!m) return null;
    const taken = { ...m, attempts: m.attempts + 1 };
    this.running.set(m.id, taken);
    return taken;
  }

  async ack(id: string) {
    const m = this.running.get(id);
    this.running.delete(id);
    if (m) this.byJob.delete(m.jobId);
  }

  async fail(id: string, retryable: boolean) {
    const m = this.running.get(id);
    if (!m) throw new Error("mensagem desconhecida");
    this.running.delete(id);
    if (retryable && m.attempts < this.maxAttempts) {
      this.ready.push(m);
      return "requeued" as const;
    }
    this.dead.set(id, m);
    return "dead" as const;
  }

  async retry(id: string) {
    const m = this.running.get(id) ?? this.dead.get(id);
    if (!m) throw new Error("mensagem desconhecida");
    this.running.delete(id);
    this.dead.delete(id);
    this.ready.push({ ...m, attempts: 0 });
  }

  /** Para testes: quantas mensagens há em cada estado. */
  sizes() {
    return { ready: this.ready.length, running: this.running.size, dead: this.dead.size };
  }
}
