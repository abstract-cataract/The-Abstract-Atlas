// 11/20: resets EVERY location's scores (fresh start for the new release).
//
// SAFE BY DEFAULT: without --yes it only COUNTS what it would delete.
//
//   1. Find your table name (the stack name is the one you gave `sam deploy --guided`):
//        aws cloudformation describe-stack-resource --stack-name <your-stack> --logical-resource-id GameTable \
//          --query StackResourceDetail.PhysicalResourceId --output text
//   2. Look first:
//        npm run reset-scores -- --table <TableName>
//   3. Delete (can't be undone):
//        npm run reset-scores -- --table <TableName> --yes
//
// What it deletes, for every player:
//   RESULT#...    best score per location (badges and progress go with it, since they're earned per run)
//   LOCTOTAL#...  leaderboard rows
//   ATTEMPT#...   runs in progress
// What it keeps: player profiles and names, accounts, challenge links, and the "what everyone said" answer counts.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const table = opt('table') ?? process.env.TABLE_NAME;
const really = args.includes('--yes');
if (!table) {
  console.error('Usage: npm run reset-scores -- --table <TableName> [--yes]');
  process.exit(1);
}

const PREFIXES = ['RESULT#', 'LOCTOTAL#', 'ATTEMPT#'];
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const items = [];
let startKey;
do {
  const out = await db.send(
    new ScanCommand({
      TableName: table,
      FilterExpression: 'begins_with(PK, :p) AND (begins_with(SK, :a) OR begins_with(SK, :b) OR begins_with(SK, :c))',
      ExpressionAttributeValues: { ':p': 'PLAYER#', ':a': PREFIXES[0], ':b': PREFIXES[1], ':c': PREFIXES[2] },
      ProjectionExpression: 'PK, SK',
      ExclusiveStartKey: startKey,
    }),
  );
  items.push(...(out.Items ?? []));
  startKey = out.LastEvaluatedKey;
} while (startKey);

for (const p of PREFIXES) console.log(`${p.padEnd(10)} ${items.filter((i) => String(i.SK).startsWith(p)).length}`);
if (!really) {
  console.log('\nNothing deleted. Run again with --yes to reset every location.');
  process.exit(0);
}
for (let i = 0; i < items.length; i += 25) {
  await db.send(
    new BatchWriteCommand({
      RequestItems: { [table]: items.slice(i, i + 25).map((it) => ({ DeleteRequest: { Key: { PK: it.PK, SK: it.SK } } })) },
    }),
  );
}
console.log(`\nDeleted ${items.length} items. Every leaderboard and score is back to zero.`);
