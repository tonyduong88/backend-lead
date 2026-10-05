'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      const sql = (text) => queryInterface.sequelize.query(text, { transaction });
      await sql("LOCK TABLE wallets IN ACCESS EXCLUSIVE MODE");
      const [rows] = await sql("SELECT id FROM wallets WHERE balance <> 0 LIMIT 1");
      if (rows.length) throw new Error('Nonzero legacy wallets need a verified opening ledger; migration refused');
      await sql(`
        ALTER TABLE wallets
          ADD COLUMN required_turnover DECIMAL(36,18) NOT NULL DEFAULT 0,
          ADD COLUMN accrued_turnover DECIMAL(36,18) NOT NULL DEFAULT 0,
          ADD CONSTRAINT wallets_money_valid CHECK (
            balance >= 0 AND balance <> 'NaN'::numeric AND
            required_turnover >= 0 AND required_turnover <> 'NaN'::numeric AND
            accrued_turnover >= 0 AND accrued_turnover <> 'NaN'::numeric
          );
        CREATE TABLE funding_txs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
          type TEXT NOT NULL CHECK (type IN ('Deposit','Withdrawal')),
          status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Completed','Failed')),
          amount DECIMAL(36,18) NOT NULL CHECK (amount > 0 AND amount <> 'NaN'::numeric),
          provider TEXT,
          psp_ref TEXT,
          turnover_multiplier BIGINT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT funding_reference_unique UNIQUE (provider, psp_ref),
          CONSTRAINT funding_wallet_identity UNIQUE (id, wallet_id),
          CONSTRAINT funding_type_fields CHECK (
            (type = 'Deposit' AND provider IS NOT NULL AND length(provider) > 0
              AND psp_ref IS NOT NULL AND length(psp_ref) > 0
              AND turnover_multiplier IS NOT NULL AND turnover_multiplier BETWEEN 0 AND 9007199254740991)
            OR (type = 'Withdrawal' AND provider IS NULL AND psp_ref IS NULL AND turnover_multiplier IS NULL)
          )
        );
        CREATE INDEX funding_wallet_idx ON funding_txs(wallet_id);
        CREATE TABLE wallet_txs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
          funding_tx_id UUID,
          kind TEXT NOT NULL CHECK (kind IN ('DepositCredit','WagerDebit','WithdrawalDebit')),
          operation_key TEXT NOT NULL UNIQUE,
          delta DECIMAL(36,18) NOT NULL,
          required_turnover_delta DECIMAL(36,18) NOT NULL DEFAULT 0,
          accrued_turnover_delta DECIMAL(36,18) NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT ledger_funding_wallet_fk FOREIGN KEY (funding_tx_id, wallet_id)
            REFERENCES funding_txs(id, wallet_id) ON DELETE RESTRICT,
          CONSTRAINT ledger_funding_effect_unique UNIQUE (funding_tx_id, kind),
          CONSTRAINT ledger_money_finite CHECK (delta <> 'NaN'::numeric
            AND required_turnover_delta <> 'NaN'::numeric AND accrued_turnover_delta <> 'NaN'::numeric),
          CONSTRAINT ledger_effect_valid CHECK (
            (kind = 'DepositCredit' AND funding_tx_id IS NOT NULL AND delta > 0
              AND required_turnover_delta >= 0 AND accrued_turnover_delta = 0)
            OR (kind = 'WagerDebit' AND funding_tx_id IS NULL AND delta < 0
              AND required_turnover_delta = 0 AND accrued_turnover_delta = -delta)
            OR (kind = 'WithdrawalDebit' AND funding_tx_id IS NOT NULL AND delta < 0
              AND required_turnover_delta = 0 AND accrued_turnover_delta = 0)
          )
        );
        CREATE INDEX ledger_wallet_history_idx ON wallet_txs(wallet_id, created_at, id);
        CREATE FUNCTION reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'wallet_txs is append-only' USING ERRCODE = '55000';
        END;
        $$;
        CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON wallet_txs
          FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
        REVOKE ALL ON FUNCTION reject_ledger_mutation() FROM PUBLIC;
      `);
    });
  },

  async down() {
    throw new Error('Financial history is not dropped by rollback. Restore a verified backup or use a forward migration.');
  },
};
