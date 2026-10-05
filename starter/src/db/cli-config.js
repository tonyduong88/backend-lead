const { settings, sslOptions } = require('./settings');
const db = settings();
const connection = {
  url: db.migration,
  dialect: 'postgres',
  logging: false,
  dialectOptions: { ...sslOptions(db.migration), application_name: 'mini-wallet-migration',
    options: '-c role=' + db.ownerRole, lock_timeout: 3000, statement_timeout: 60000 },
};

module.exports = {
  development: connection,
  test: connection,
  production: connection,
};
