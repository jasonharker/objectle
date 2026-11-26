import type { ModelCredit } from '@objectle/shared';

/** A list item crediting one model: its noun, author, source and license. */
export function creditItem({ name, credit }: ModelCredit): HTMLLIElement {
  const item = document.createElement('li');
  item.textContent = `${name}: ${credit.author}, ${credit.source}, ${credit.license}`;
  return item;
}
