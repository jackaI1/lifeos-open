import '@testing-library/jest-dom/vitest';
import {cleanup} from '@testing-library/react';
import {afterEach, beforeEach} from 'vitest';

// jsdom does not implement modal dialogs; give the shell's #dialog the minimum behaviour it relies on.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

// The same static shell elements public/index.html provides.
beforeEach(() => {
  document.body.innerHTML = '<main id="main"></main><div id="toast" role="status" hidden></div><dialog id="dialog"></dialog>';
  history.replaceState(null, '', '/#finances');
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});
