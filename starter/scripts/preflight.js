'use strict';
const { preflightTest, safeFailure } = require('./lib/db');
preflightTest().then(() => console.log('Isolated test database verified.')).catch(safeFailure);
