const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(require.resolve('./app.js'), 'utf8');
const helpers = source.slice(source.indexOf('      function secretActionIcon('), source.indexOf('      function readSecretEditorForm('));

function setup(writeText) {
  const messages = [];
  const timers = [];
  const context = vm.createContext({
    navigator: { clipboard: { writeText } },
    window: { setTimeout: (fn) => timers.push(fn) },
    setSecretsMsg: (...args) => messages.push(args),
    escapeHtml: (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
  });
  vm.runInContext(helpers, context);
  const input = { value: '  sample\nvalue  ', type: 'password' };
  const classes = new Set();
  const button = {
    disabled: false,
    closest: () => ({ querySelector: () => input }),
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    setAttribute(name, value) { this[name] = value; },
  };
  return { context, messages, timers, input, button, classes };
}

test('secret rows have masked values and accessible icon actions', () => {
  const { context } = setup();
  const html = context.secretKeyRowHtml('TOKEN', 'a"<b');
  assert.match(html, /type="password"/);
  assert.match(html, /value="a&quot;&lt;b"/);
  assert.match(html, /aria-label="Reveal value"/);
  assert.match(html, /aria-label="Copy value"/);
  assert.match(html, /aria-hidden="true"/);
});

test('copy preserves the exact current value without revealing it and resets feedback', async () => {
  let copied;
  const { context, button, input, classes, timers, messages } = setup(async (value) => { copied = value; });
  await context.copySecretValue(button);
  assert.equal(copied, input.value);
  assert.equal(input.type, 'password');
  assert.equal(button['aria-label'], 'Copied');
  assert.equal(button.disabled, true);
  assert.ok(classes.has('is-copied'));
  assert.equal(messages[0][0], 'Value copied to clipboard.');
  timers[0]();
  assert.equal(button['aria-label'], 'Copy value');
  assert.equal(button.disabled, false);
  assert.equal(classes.has('is-copied'), false);
});

test('clipboard rejection offers recovery without exposing a value or exception', async () => {
  const { context, button, input, messages } = setup(async () => { throw new Error('sensitive error'); });
  await context.copySecretValue(button);
  assert.equal(button.disabled, false);
  assert.equal(input.type, 'password');
  assert.equal(messages[0][1], true);
  assert.match(messages[0][0], /Allow clipboard access/);
  assert.ok(!messages[0][0].includes('sensitive error'));
});

test('unavailable clipboard API reports the same safe recovery', async () => {
  const { context, button, messages } = setup();
  context.navigator.clipboard = undefined;
  await context.copySecretValue(button);
  assert.equal(button.disabled, false);
  assert.equal(messages[0][1], true);
});
