// 国发〔2005〕38 号附件。仅供整周岁查表，非整周岁由使用者按经办口径填写。
export const PENSION_DIVISORS = [233, 230, 226, 223, 220, 216, 212, 208, 204, 199,
  195, 190, 185, 180, 175, 170, 164, 158, 152, 145, 139, 132, 125, 117, 109,
  101, 93, 84, 75, 65, 56];

const MAX_MONEY = 100_000_000;
const MAX_MONTHS = 720;
const ACCOUNT_SHARE = 0.08;

function number(value, label, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label}须为 ${min} 至 ${max} 之间的${integer ? '整数' : '数字'}。`);
  }
  return value;
}

export function parsePensionMonth(value) {
  if (typeof value !== 'string' || !/^(?:19\d{2}|20\d{2}|21\d{2})-(?:0[1-9]|1[0-2])$/.test(value)) {
    throw new Error('请输入有效年月，格式如 2035-06。');
  }
  const [year, month] = value.split('-').map(Number);
  return year * 12 + month - 1;
}

export function minimumPensionMonths(year) {
  number(year, '对照年份', 2025, 2199, true);
  // 2030 年起每年增加 6 个月，2039 年达到 240 个月。
  return 180 + Math.min(10, Math.max(0, year - 2029)) * 6;
}

export function calculatePension({ retirementYear, referenceYear = retirementYear, pensionBase,
  averageIndex, paidMonths, balance, divisor, transitional = null }) {
  number(retirementYear, '退休年份', 2025, 2199, true);
  number(referenceYear, '最低缴费年限对照年份', 2025, retirementYear, true);
  number(pensionBase, '养老金计发基数', 0.01, MAX_MONEY);
  number(averageIndex, '平均缴费指数', 0, 10);
  number(paidMonths, '累计缴费月数', 0, MAX_MONTHS, true);
  number(balance, '个人账户余额', 0, MAX_MONEY);
  number(divisor, '个人账户计发月数', 1, 600);
  if (transitional !== null) number(transitional, '过渡性养老金', 0, MAX_MONEY);

  const indexedPay = pensionBase * averageIndex;
  const basic = (pensionBase + indexedPay) / 2 * (paidMonths / 12) * 0.01;
  const personal = balance / divisor;
  const minimumMonths = minimumPensionMonths(referenceYear);
  return {
    retirementYear, referenceYear, pensionBase, averageIndex, paidMonths, balance, divisor,
    indexedPay, basic, personal, transitional, total: basic + personal + (transitional ?? 0),
    minimumMonths, missingMonths: Math.max(0, minimumMonths - paidMonths),
  };
}

export function forecastPension({ asOf, retirement, paidMonths, pastIndex, balance, pensionBase,
  futureMonths, futureIndex, contributionBase, pensionGrowth = 0, contributionGrowth = 0,
  accountInterest = 0, divisor, transitional, referenceYear }) {
  const start = parsePensionMonth(asOf);
  const end = parsePensionMonth(retirement);
  const horizon = end - start;
  number(horizon, '预测跨度（月）', 0, MAX_MONTHS, true);
  number(paidMonths, '已缴月数', 0, MAX_MONTHS, true);
  number(balance, '当前个人账户余额', 0, MAX_MONEY);
  number(pensionBase, '参考计发基数', 0.01, MAX_MONEY);
  const months = futureMonths ?? horizon;
  number(months, '未来实际缴费月数', 0, horizon, true);
  if (paidMonths > 0) number(pastIndex, '已缴平均缴费指数', 0.01, 10);
  if (months > 0) {
    number(futureIndex, '未来平均缴费指数', 0.01, 10);
    number(contributionBase, '未来首月缴费基数', 0.01, MAX_MONEY);
  }

  const monthlyFactor = (percent, label) => (1 + number(percent, label, -20, 20) / 100) ** (1 / 12);
  const pensionFactor = monthlyFactor(pensionGrowth, '计发基数年增长率');
  const contributionFactor = monthlyFactor(contributionGrowth, '缴费基数年增长率');
  const interestFactor = monthlyFactor(accountInterest, '个人账户年记账利率假设');
  let projectedBalance = balance;
  let totalContributions = 0;
  let accountGrowth = 0;
  for (let month = 0; month < horizon; month++) {
    // 先给原余额计息，再把当月缴费的 8% 记入个人账户。
    const contribution = month < months ? contributionBase * contributionFactor ** month * ACCOUNT_SHARE : 0;
    const interest = projectedBalance * (interestFactor - 1);
    projectedBalance += interest + contribution;
    totalContributions += contribution;
    accountGrowth += interest;
  }

  const totalMonths = paidMonths + months;
  const pastWeight = paidMonths > 0 ? pastIndex * paidMonths : 0;
  const futureWeight = months > 0 ? futureIndex * months : 0;
  const averageIndex = totalMonths ? (pastWeight + futureWeight) / totalMonths : 0;
  const result = calculatePension({
    retirementYear: Math.floor(end / 12), referenceYear,
    pensionBase: pensionBase * pensionFactor ** horizon,
    averageIndex, paidMonths: totalMonths, balance: projectedBalance, divisor, transitional,
  });
  return { ...result, horizon, futureMonths: months, totalContributions, accountGrowth };
}
