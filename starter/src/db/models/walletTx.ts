import { DataTypes, Model, Sequelize } from 'sequelize';

export type LedgerKind = 'DepositCredit' | 'WagerDebit' | 'WithdrawalDebit';
export class WalletTx extends Model {
  declare id: string;
  declare walletId: string;
  declare fundingTxId: string | null;
  declare kind: LedgerKind;
  declare operationKey: string;
  declare delta: string;
  declare requiredTurnoverDelta: string;
  declare accruedTurnoverDelta: string;
  declare createdAt: Date;
}

export function initWalletTx(sequelize: Sequelize): void {
  WalletTx.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    walletId: { type: DataTypes.UUID, allowNull: false },
    fundingTxId: { type: DataTypes.UUID, allowNull: true },
    kind: { type: DataTypes.TEXT, allowNull: false },
    operationKey: { type: DataTypes.TEXT, allowNull: false },
    delta: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
    requiredTurnoverDelta: { type: DataTypes.DECIMAL(36, 18), allowNull: false, defaultValue: '0' },
    accruedTurnoverDelta: { type: DataTypes.DECIMAL(36, 18), allowNull: false, defaultValue: '0' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, { sequelize, tableName: 'wallet_txs', underscored: true, timestamps: false });
}
