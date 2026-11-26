import { creditItem } from './credit.ts';
import { loadCredits, outageMessage } from './game.ts';

const list = document.querySelector('#credits')!;
const message = document.querySelector('#message')!;

try {
  list.replaceChildren(...(await loadCredits(fetch)).map(creditItem));
} catch (error) {
  message.textContent = error instanceof Error ? error.message : outageMessage;
}
