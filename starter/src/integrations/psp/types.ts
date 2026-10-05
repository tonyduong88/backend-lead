export type TerminalDepositEvent = {
  kind: 'terminal'; provider: string; pspRef: string;
  status: 'completed' | 'failed'; amount: string; providerEventId?: string;
};
export type DepositObservation = {
  kind: 'observation'; provider: string; pspRef: string;
  status: 'pending'; amount?: string; providerEventId?: string;
};
export type CallbackResult = { id: string; status: string };

export interface PspAdapter {
  verifyAndNormalize(input: {
    rawBody: Buffer;
    headers: Readonly<Record<string, string | string[] | undefined>>;
  }): Promise<TerminalDepositEvent | DepositObservation>;
  acknowledgement(result: CallbackResult): { status: number; body: unknown };
}
