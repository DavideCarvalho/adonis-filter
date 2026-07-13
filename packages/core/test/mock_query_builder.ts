// The recording mock now lives in `src/testing.ts` so it can be published under
// the `@adonis-agora/filter/testing` subpath. Re-exported here to keep the
// existing test imports (`./mock_query_builder.js`) working unchanged.
export { MockQueryBuilder, makeMockQueryBuilder, type RecordedCall } from '../src/testing.js';
