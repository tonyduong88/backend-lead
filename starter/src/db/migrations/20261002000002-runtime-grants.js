'use strict';

const { settings } = require('../settings');

module.exports = {
  async up(queryInterface) {
    const { runtimeRole } = settings();
    // Both names come from a fixed application allowlist, not request input.
    const role = runtimeRole === 'wallet_test_app' ? 'wallet_test_app' : 'wallet_app';
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(`
        REVOKE ALL ON members, wallets, funding_txs, wallet_txs FROM PUBLIC;
        REVOKE ALL ON members, wallets, funding_txs, wallet_txs FROM ${role};
        GRANT USAGE ON SCHEMA public TO ${role};
        GRANT SELECT, INSERT ON members, wallets, funding_txs, wallet_txs TO ${role};
        GRANT UPDATE (balance, required_turnover, accrued_turnover, updated_at) ON wallets TO ${role};
        GRANT UPDATE (status, updated_at) ON funding_txs TO ${role};
      `, { transaction });
    });
  },
  async down() { throw new Error('Runtime privileges must be changed by a forward migration'); },
};
