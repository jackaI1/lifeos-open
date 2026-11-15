// Page glue for the visitor check. Nothing here stores, uploads or reads more than the consented check.
import {collectSignals} from './signals.mjs';
import {scoreSignals} from './scorer.mjs';

window.lifeosBotCheck = {collect: collectSignals, score: scoreSignals};

const button = document.querySelector('#consent');
const output = document.querySelector('#result');
const list = document.querySelector('#reasons');

button?.addEventListener('click', async () => {
  button.disabled = true;
  output.textContent = 'Checking for 3 seconds. Move your mouse now.';
  const result = scoreSignals(await collectSignals({consent: true, observeMs: 3000}));
  output.textContent = `Verdict: ${result.verdict}`;
  list.replaceChildren(...result.reasons.map(reason => {
    const item = document.createElement('li');
    item.textContent = `${reason.label}: ${reason.status}${reason.detail ? ` (${reason.detail})` : ''}`;
    return item;
  }));
});
