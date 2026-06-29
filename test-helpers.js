import assert from 'assert';
import { getUserId, resolveRepo, normalizeLabels, parseOpenAIResponse } from './src/index.js';

console.log('Running helper self-checks...');

// 1. getUserId
const interaction1 = { member: { user: { id: '123' } } };
const interaction2 = { user: { id: '456' } };
const interaction3 = {};
assert.strictEqual(getUserId(interaction1), '123');
assert.strictEqual(getUserId(interaction2), '456');
assert.strictEqual(getUserId(interaction3), 'unknown');
console.log('getUserId passed');

// 2. resolveRepo
const mapJson = JSON.stringify({
  guilds: {
    g123: {
      channels: {
        c456: 'owner/repo'
      }
    }
  }
});
assert.strictEqual(resolveRepo('g123', 'c456', mapJson), 'owner/repo');

assert.throws(() => {
  resolveRepo('g123', 'unknown_channel', mapJson);
}, /Channel này chưa được map với repo nào/);

assert.throws(() => {
  resolveRepo('g123', 'c456', 'invalid_json');
}, /Cấu hình repo mapping lỗi/);

// Test invalid repo name regex
const mapJsonInvalidRepo = JSON.stringify({
  guilds: {
    g123: {
      channels: {
        c456: 'invalid_repo_name'
      }
    }
  }
});
assert.throws(() => {
  resolveRepo('g123', 'c456', mapJsonInvalidRepo);
}, /Repo mapping không hợp lệ/);

console.log('resolveRepo passed');

// 3. normalizeLabels
assert.deepStrictEqual(normalizeLabels(['ui', 'ui', 'unknown']), ['ui']);
assert.deepStrictEqual(normalizeLabels(['unknown']), ['enhancement']);
assert.deepStrictEqual(normalizeLabels(null), ['enhancement']);
console.log('normalizeLabels passed');

// 4. parseOpenAIResponse
const responseWithOutputText = {
  output_text: '{"title": "Bug fix", "labels": ["bug"], "body": "fix stuff"}'
};
assert.deepStrictEqual(parseOpenAIResponse(responseWithOutputText), {
  title: 'Bug fix',
  labels: ['bug'],
  body: 'fix stuff'
});

const responseWithContent = {
  output: [
    {
      content: [
        {
          type: 'text',
          text: {
            value: '{"title": "Bug fix 2", "labels": ["bug"], "body": "fix stuff 2"}'
          }
        }
      ]
    }
  ]
};
assert.deepStrictEqual(parseOpenAIResponse(responseWithContent), {
  title: 'Bug fix 2',
  labels: ['bug'],
  body: 'fix stuff 2'
});

assert.throws(() => {
  parseOpenAIResponse({ error: 'Some API error' });
}, /OpenAI error/);

assert.throws(() => {
  parseOpenAIResponse({});
}, /No parseable text in OpenAI response/);

console.log('parseOpenAIResponse passed');
console.log('All helper self-checks passed successfully!');
