import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePension, forecastPension, minimumPensionMonths, PENSION_DIVISORS } from '../src/lib/pension.js';

// 台山市社保局算例。金额用于验证公式，退休年份用于对照现行年限。
// https://www.cnts.gov.cn/zsdw/sshbxjjglj/zwgk/zfxxgkml/gzdt/content/post_2998285.html
const officialExample = { retirementYear: 2026, pensionBase: 8_682, averageIndex: 0.6,
  paidMonths: 180, balance: 55_600, divisor: PENSION_DIVISORS[60 - 40] };

test('official pension example and manual fractional divisor', () => {
  const result = calculatePension(officialExample);
  assert.equal(result.basic.toFixed(2), '1041.84');
  assert.equal(result.personal, 400);
  assert.equal(result.total.toFixed(2), '1441.84');
  assert.equal(result.transitional, null);
  const fractional = calculatePension({ ...officialExample, divisor: 138.5, transitional: 123.45 });
  assert.equal(fractional.personal, 55_600 / 138.5);
  assert.equal(fractional.total.toFixed(2), '1566.73');
});

test('minimum contribution transitions by six months and uses the supplied statutory year for delayed retirement', () => {
  assert.deepEqual([2029, 2030, 2038, 2039, 2070].map(minimumPensionMonths), [180, 186, 234, 240, 240]);
  const assumptions = { ...officialExample, retirementYear: 2034, paidMonths: 192 };
  assert.equal(calculatePension(assumptions).missingMonths, 18);
  assert.equal(calculatePension({ ...assumptions, referenceYear: 2031 }).missingMonths, 0);
  assert.throws(() => calculatePension({ ...assumptions, referenceYear: 2035 }), /对照年份/);
});

const projection = { asOf: '2026-10', retirement: '2036-10', paidMonths: 186, pastIndex: 0.8,
  balance: 60_000, pensionBase: 8_000, contributionBase: 9_600, futureIndex: 1.2, divisor: 117 };

test('forecast uses contribution months, 8% credit and weighted indices', () => {
  const result = forecastPension(projection);
  assert.equal(result.horizon, 120);
  assert.equal(result.paidMonths, 306);
  assert.equal(result.minimumMonths, 222);
  assert.equal(result.averageIndex, (186 * 0.8 + 120 * 1.2) / 306);
  assert.equal(result.balance, 152_160);
  assert.equal(result.accountGrowth, 0);
  assert.equal(result.total.toFixed(2), '3296.51');
});

test('monthly interest precedes the contribution and continues during nonpayment months', () => {
  const result = forecastPension({ ...projection, retirement: '2027-10', futureMonths: 1,
    pensionGrowth: 4, accountInterest: 12 });
  const expected = 60_000 * 1.12 + 768 * 1.12 ** (11 / 12);
  assert.ok(Math.abs(result.balance - expected) < 1e-8);
  assert.ok(Math.abs(result.pensionBase - 8320) < 1e-8);
  assert.equal(result.paidMonths, 187);
  assert.equal(result.totalContributions, 768);
  const stopped = forecastPension({ ...projection, futureMonths: 0, futureIndex: undefined, contributionBase: undefined });
  assert.equal(stopped.balance, 60_000);
  assert.equal(stopped.paidMonths, 186);
});

test('invalid dates, impossible future payments and invalid divisors fail before returning an estimate', () => {
  assert.throws(() => forecastPension({ ...projection, retirement: '2026-13' }), /有效年月/);
  assert.throws(() => forecastPension({ ...projection, retirement: '2026-09' }), /预测跨度/);
  assert.throws(() => forecastPension({ ...projection, futureMonths: 121 }), /未来实际缴费/);
  assert.throws(() => forecastPension({ ...projection, futureIndex: undefined }), /未来平均缴费指数/);
  assert.throws(() => calculatePension({ ...officialExample, divisor: 0 }), /计发月数/);
});
