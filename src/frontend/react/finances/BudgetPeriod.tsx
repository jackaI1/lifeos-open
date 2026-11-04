import {useEffect, useRef} from 'react';
import {swipeDays} from '@shell/day-navigation.js';
import {FINANCE_CATEGORIES} from '@shell/finance-model.js';
import {IconButton} from '../shared/shell-bridge';
import {money, PERIOD_LABELS} from './format';
import type {AllowanceCard, Period} from './types';

/** swipeDays has no teardown, so bind each section once even if effects re-run (StrictMode). */
const swipeBound = new WeakSet<HTMLElement>();

export interface BudgetPeriodProps {
  period: Period;
  cards: AllowanceCard[];
  /** When recent bank activity is missing, remaining amounts are upper bounds. */
  provisional: boolean;
  onMove: (delta: 1 | -1) => void;
}

/** Period switcher plus the three spending allowances (Dining, Shopping, Big Purchase). */
export function BudgetPeriod({period, cards, provisional, onMove}: BudgetPeriodProps) {
  const section = useRef<HTMLElement>(null);
  const move = useRef(onMove);
  move.current = onMove;
  useEffect(() => {
    const node = section.current!;
    if (swipeBound.has(node)) return;
    swipeBound.add(node);
    swipeDays(node, delta => move.current(delta));
  }, []);

  return (
    <section className="finance-budget" ref={section}>
      <div className="finance-period">
        <IconButton icon="left" label="Previous budget period" onClick={() => onMove(-1)} />
        <h2 aria-live="polite">{PERIOD_LABELS[period]}</h2>
        <IconButton icon="right" label="Next budget period" onClick={() => onMove(1)} />
      </div>
      <div className="finance-allowances">
        {cards.map(card => (
          <div className="finance-allowance" key={card.id}>
            <div>
              <h3>{FINANCE_CATEGORIES[card.id]}</h3>
              <span className="finance-rule">{card.rule}</span>
            </div>
            <div className={'finance-remaining' + (card.remaining < 0 ? ' over-budget' : '')}>
              <strong>{(provisional ? 'Up to ' : '') + money(card.remaining)}</strong>
              <span>{money(card.spent) + ' recorded'}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
