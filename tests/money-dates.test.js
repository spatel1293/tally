import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatMoney, centsToInput, centsToDecimalString, scaleCents, MAX_CENTS, isSupportedCurrency } from '../js/core/money.js';
import {
  addDays, addMonthsClamped, daysInMonth, isValidISODate, monthKeyAdd, monthRange, parseFlexibleDate, todayISO, daysBetween, formatMonth,
} from '../js/core/dates.js';

const cents = (s, locale) => {
  const r = parseAmount(s, { locale });
  assert.equal(r.ok, true, `expected "${s}" to parse, got: ${r.error}`);
  return r.negative ? -r.cents : r.cents;
};
const error = (s, locale) => {
  const r = parseAmount(s, { locale });
  assert.equal(r.ok, false, `expected "${s}" to fail`);
  return r.error;
};

describe('parseAmount', () => {
  test('plain numbers and decimals', () => {
    assert.equal(cents('12'), 1200);
    assert.equal(cents('12.5'), 1250);
    assert.equal(cents('12.50'), 1250);
    assert.equal(cents('0.01'), 1);
    assert.equal(cents('.99'), 99);
    assert.equal(cents('12.'), 1200);
    assert.equal(cents('007.10'), 710);
  });

  test('never uses floating point (classic 0.1 + 0.2 style values)', () => {
    assert.equal(cents('0.29'), 29);
    assert.equal(cents('1.15'), 115);
    assert.equal(cents('4.35'), 435);
    assert.equal(cents('19.99') + cents('0.01'), 2000);
  });

  test('currency symbols, codes, grouping and whitespace', () => {
    assert.equal(cents('$1,234.56'), 123456);
    assert.equal(cents(' $ 12 '), 1200);
    assert.equal(cents('USD 12.00'), 1200);
    assert.equal(cents('12.00 USD'), 1200);
    assert.equal(cents('1,234,567'), 123456700);
    assert.equal(cents("1'234.50"), 123450);
    assert.equal(cents('€1\u00a0234,50', 'de-DE'), 123450);
  });

  test('sign handling', () => {
    assert.equal(cents('-12.50'), -1250);
    assert.equal(cents('-$12.50'), -1250);
    assert.equal(cents('$-12.50'), -1250);
    assert.equal(cents('(12.50)'), -1250);
    assert.equal(cents('12.50-'), -1250);
    assert.equal(cents('+12.50'), 1250);
    assert.equal(cents('\u221212.50'), -1250);
    assert.equal(parseAmount('-0').negative, false);
  });

  test('locale-aware separators', () => {
    assert.equal(cents('1.234,56', 'de-DE'), 123456);
    assert.equal(cents('12,5', 'de-DE'), 1250);
    assert.equal(cents('1.234', 'de-DE'), 123400);
    assert.equal(cents('1,234', 'en-US'), 123400);
    // A lone comma with 1–2 digits after it is clearly a decimal, even in en-US.
    assert.equal(cents('12,5', 'en-US'), 1250);
    assert.equal(cents('12,50', 'en-US'), 1250);
  });

  test('rejects bad input with plain-language messages', () => {
    assert.match(error(''), /Enter an amount/);
    assert.match(error('   '), /Enter an amount/);
    assert.match(error('abc'), /numbers only/);
    assert.match(error('12abc'), /numbers only/);
    assert.match(error('1.234'), /2 decimal places/);
    assert.match(error('12.345'), /2 decimal places/);
    assert.match(error('1,2,3'), /number format/);
    assert.match(error('1.2.3,4', 'en-US'), /number format/);
    assert.match(error('$'), /numbers only/);
    assert.match(error('--5'), /numbers only/);
  });

  test('enforces the maximum', () => {
    assert.equal(cents('1000000000'), MAX_CENTS);
    assert.match(error('1000000000.01'), /too large/);
    assert.match(error('99999999999999999999'), /too large/);
  });
});

describe('formatMoney', () => {
  test('USD formatting', () => {
    assert.equal(formatMoney(123456), '$1,234.56');
    assert.equal(formatMoney(5), '$0.05');
    assert.equal(formatMoney(-1250), '-$12.50');
    assert.equal(formatMoney(0), '$0.00');
    assert.equal(formatMoney(-0), '$0.00');
    assert.equal(formatMoney(1250, { sign: true }), '+$12.50');
    assert.equal(formatMoney(0, { sign: true }), '$0.00');
    assert.equal(formatMoney(MAX_CENTS), '$1,000,000,000.00');
  });

  test('other currencies and locales', () => {
    assert.equal(formatMoney(123456, { currency: 'EUR', locale: 'de-DE' }), '1.234,56\u00a0€');
    assert.equal(formatMoney(150000, { currency: 'JPY', locale: 'ja-JP' }), '￥1,500');
    assert.equal(formatMoney(123456, { currency: 'GBP', locale: 'en-GB' }), '£1,234.56');
  });

  test('compact notation', () => {
    assert.equal(formatMoney(150000, { compact: true }), '$1.5K');
    assert.equal(formatMoney(0, { compact: true }), '$0');
  });

  test('bad currency falls back instead of throwing', () => {
    assert.doesNotThrow(() => formatMoney(100, { currency: 'NOPE' }));
    assert.equal(isSupportedCurrency('EUR'), true);
    assert.equal(isSupportedCurrency('eur'), false);
    assert.equal(isSupportedCurrency('NOPE'), false);
  });

  test('round trips for editing and export', () => {
    assert.equal(centsToInput(1250), '12.50');
    assert.equal(centsToInput(1200), '12');
    assert.equal(centsToInput(1205, { locale: 'de-DE' }), '12,05');
    assert.equal(centsToInput(-5), '-0.05');
    for (const v of [1, 99, 100, 1250, 123456, MAX_CENTS]) {
      assert.equal(cents(centsToInput(v)), v);
      assert.equal(cents(centsToDecimalString(v)), v);
    }
    assert.equal(centsToDecimalString(123450), '1234.50');
    assert.equal(centsToDecimalString(-7), '-0.07');
  });

  test('scaleCents rounds half away from zero', () => {
    assert.equal(scaleCents(100, 52, 12), 433); // 433.33
    assert.equal(scaleCents(3, 1, 2), 2); // 1.5 -> 2
    assert.equal(scaleCents(-3, 1, 2), -2);
    assert.equal(scaleCents(1000, 26, 12), 2167); // 2166.67
  });
});

describe('dates', () => {
  test('validation', () => {
    assert.equal(isValidISODate('2024-02-29'), true);
    assert.equal(isValidISODate('2023-02-29'), false);
    assert.equal(isValidISODate('2024-13-01'), false);
    assert.equal(isValidISODate('2024-00-10'), false);
    assert.equal(isValidISODate('2024-4-1'), false);
    assert.equal(isValidISODate(null), false);
    assert.equal(daysInMonth(2024, 2), 29);
    assert.equal(daysInMonth(1900, 2), 28);
    assert.equal(daysInMonth(2000, 2), 29);
  });

  test('addDays crosses months, years and DST boundaries', () => {
    assert.equal(addDays('2024-01-31', 1), '2024-02-01');
    assert.equal(addDays('2024-12-31', 1), '2025-01-01');
    assert.equal(addDays('2024-03-01', -1), '2024-02-29');
    assert.equal(addDays('2024-03-09', 1), '2024-03-10'); // US DST start
    assert.equal(addDays('2024-11-02', 2), '2024-11-04'); // US DST end
    assert.equal(daysBetween('2024-01-01', '2025-01-01'), 366);
  });

  test('addMonthsClamped keeps the anchor day', () => {
    assert.equal(addMonthsClamped('2024-01-31', 1), '2024-02-29');
    assert.equal(addMonthsClamped('2023-01-31', 1), '2023-02-28');
    assert.equal(addMonthsClamped('2024-01-31', 2), '2024-03-31');
    assert.equal(addMonthsClamped('2024-11-15', 3), '2025-02-15');
    assert.equal(addMonthsClamped('2024-02-29', 12), '2025-02-28');
    assert.equal(addMonthsClamped('2024-02-29', 48), '2028-02-29');
    assert.equal(addMonthsClamped('2024-03-15', -3), '2023-12-15');
  });

  test('month keys', () => {
    assert.equal(monthKeyAdd('2024-12', 1), '2025-01');
    assert.equal(monthKeyAdd('2024-01', -1), '2023-12');
    assert.equal(monthKeyAdd('2024-06', -18), '2022-12');
    assert.deepEqual(monthRange('2024-02'), { start: '2024-02-01', end: '2024-02-29' });
    assert.equal(formatMonth('2024-02', 'en-US'), 'February 2024');
  });

  test('todayISO uses the local calendar', () => {
    assert.equal(todayISO(new Date(2024, 0, 5, 23, 59)), '2024-01-05');
    assert.equal(todayISO(new Date(2024, 0, 6, 0, 1)), '2024-01-06');
  });

  test('parseFlexibleDate', () => {
    assert.equal(parseFlexibleDate('2024-03-05'), '2024-03-05');
    assert.equal(parseFlexibleDate('2024-03-05T10:00:00Z'), '2024-03-05');
    assert.equal(parseFlexibleDate('2024/3/5'), '2024-03-05');
    assert.equal(parseFlexibleDate('03/05/2024'), '2024-03-05');
    assert.equal(parseFlexibleDate('03/05/2024', 'DMY'), '2024-05-03');
    assert.equal(parseFlexibleDate('5.3.24', 'DMY'), '2024-03-05');
    assert.equal(parseFlexibleDate('12/31/99'), '1999-12-31');
    assert.equal(parseFlexibleDate('13/01/2024'), null);
    assert.equal(parseFlexibleDate('02/30/2024'), null);
    assert.equal(parseFlexibleDate('yesterday'), null);
    assert.equal(parseFlexibleDate(''), null);
  });
});
