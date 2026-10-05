import { DataTypes, Model, Sequelize } from 'sequelize';

export type FundingStatus = 'Pending' | 'Completed' | 'Failed';
export class FundingTx extends Model {
  declare id: string;
  declare walletId: string;
  declare type: 'Deposit' | 'Withdrawal';
  declare status: FundingStatus;
  declare amount: string;
  declare provider: string | null;
  declare pspRef: string | null;
  declare turnoverMultiplier: string | null;
}

export function initFundingTx(sequelize: Sequelize): void {
  FundingTx.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    walletId: { type: DataTypes.UUID, allowNull: false },
    type: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'Pending' },
    amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
    provider: { type: DataTypes.TEXT, allowNull: true },
    pspRef: { type: DataTypes.TEXT, allowNull: true },
    turnoverMultiplier: { type: DataTypes.BIGINT, allowNull: true },
  }, { sequelize, tableName: 'funding_txs', underscored: true });
}
