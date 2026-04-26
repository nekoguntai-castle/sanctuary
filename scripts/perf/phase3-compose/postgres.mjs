
import { parseLastJsonLine } from './common.mjs';

export function createPostgresJsonRunner(context) {
  const {
    postgresUser,
    postgresDb,
    runCompose,
  } = context;

  function runPostgresJson(sql) {
    const output = runCompose([
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      postgresUser,
      '-d',
      postgresDb,
      '-v',
      'ON_ERROR_STOP=1',
      '-t',
      '-A',
      '-c',
      sql,
    ]);
    return parseLastJsonLine(output);
  }

  return runPostgresJson;
}
