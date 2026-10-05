import { sequelize } from '../db/sequelize';
import { Member, Wallet } from '../db/models';
import { AppError, databaseErrorCode } from '../lib/errors';

// Convention: any operation touching more than one row runs inside a single
// DB transaction. Keep this pattern for everything you add.
export async function createMember(username: string): Promise<{ member: Member; wallet: Wallet }> {
  try { return await sequelize.transaction(async (t) => {
    const member = await Member.create({ username }, { transaction: t });
    const wallet = await Wallet.create({ memberId: member.id, balance: '0' }, { transaction: t });
    return { member, wallet };
  });
  } catch (error) {
    if (databaseErrorCode(error) === '23505'
      && (error as { original?: { constraint?: string } }).original?.constraint === 'members_username_key') {
      throw new AppError(409, 'username_taken');
    }
    throw error;
  }
}

export async function getWalletByMemberId(memberId: string): Promise<Wallet | null> {
  return Wallet.findOne({ where: { memberId } });
}
