import { calculatePension, forecastPension, PENSION_DIVISORS } from './lib/pension.js';

const money = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const indexFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 });
const duration = months => `${Math.floor(months / 12)} 年 ${months % 12} 个月`;

function lastMonth() {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric' }).formatToParts();
  const year = Number(parts.find(part => part.type === 'year').value);
  const month = Number(parts.find(part => part.type === 'month').value);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

function renderPairs(list, pairs) {
  list.replaceChildren(...pairs.map(([label, value]) => {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value;
    row.append(term, detail);
    return row;
  }));
}

export function initPension() {
  const $ = id => document.getElementById(`pn-${id}`);
  const form = $('form');
  const mode = () => form.elements.mode.value;
  let example = false;

  PENSION_DIVISORS.forEach((months, index) => {
    $('age').add(new Option(`${index + 40} 周岁 · ${months} 个月`, String(months)));
  });

  function clearResult(status) {
    $('result').hidden = true;
    $('error').hidden = true;
    $('error').textContent = '';
    $('status').textContent = status;
  }

  function syncMode() {
    const forecast = mode() === 'forecast';
    for (const id of ['forecast', 'growth']) {
      $(id).hidden = !forecast;
      $(id).disabled = !forecast;
    }
    $('direct').hidden = forecast;
    $('direct').disabled = forecast;
    $('mode-help').textContent = forecast
      ? '用现有缴费记录和未来假设，估算退休时的首月养老金。'
      : '已有退休时的计发基数、缴费指数和个人账户余额，可直接测算。';
  }

  function showResult(result) {
    const forecast = mode() === 'forecast';
    const cents = amount => Math.round(amount * 100);
    const displayedTotal = (cents(result.basic) + cents(result.personal) + cents(result.transitional ?? 0)) / 100;
    const hasTransition = result.transitional !== null;
    $('amount').textContent = money.format(displayedTotal);
    $('amount-label').textContent = result.missingMonths ? '按公式测算' : hasTransition ? '预计首月养老金' : '预计首月两项小计';
    $('coverage').textContent = hasTransition
      ? '已计入填写的过渡性养老金。金额采用退休时的名义人民币。'
      : '含基础养老金和个人账户养老金。过渡性养老金若适用，可补填已知金额。';
    const threshold = `${result.referenceYear} 年最低缴费年限为 ${duration(result.minimumMonths)}。`;
    $('eligibility').textContent = result.missingMonths
      ? `${threshold}按所填参数还差 ${duration(result.missingMonths)}。公式测算金额不可作为实际可领取金额。`
      : `${threshold}按所填参数已达到该年限，领取条件由当地社保核定。`;
    $('eligibility').classList.toggle('pn-shortfall', result.missingMonths > 0);
    renderPairs($('breakdown'), [
      ['基础养老金', `${money.format(cents(result.basic) / 100)} 元`],
      ['个人账户养老金', `${money.format(cents(result.personal) / 100)} 元`],
      ['过渡性养老金', hasTransition ? `${money.format(cents(result.transitional) / 100)} 元` : '未填'],
    ]);
    const parameters = [
      ['退休时计发基数', `${money.format(result.pensionBase)} 元/月`],
      ['累计缴费年限', duration(result.paidMonths)],
      ['平均缴费指数', indexFormat.format(result.averageIndex)],
      ['指数化月平均缴费工资', `${money.format(result.indexedPay)} 元/月`],
      ['退休时个人账户余额', `${money.format(result.balance)} 元`],
      ['计发月数', `${result.divisor} 个月`],
    ];
    if (forecast) parameters.push(
      ['距退休', duration(result.horizon)],
      ['未来实际缴费', duration(result.futureMonths)],
      ['预计新增账户缴费', `${money.format(result.totalContributions)} 元`],
      ['预计账户利息', `${money.format(result.accountGrowth)} 元`],
    );
    renderPairs($('inputs'), parameters);
    $('basis').textContent = '基础养老金 =（计发基数 + 指数化月平均缴费工资）÷ 2 × 累计缴费年数 × 1%。个人账户养老金 = 退休时余额 ÷ 计发月数。'
      + (forecast ? ' 平均缴费指数按已缴和未来实际缴费月数加权。预测假设未来缴费基数的 8% 于每月末计入个人账户。' : '');
    $('status').textContent = `${example ? '示例 · ' : ''}${result.retirementYear} 年退休 · ${result.missingMonths ? '缴费年限尚有差额' : '金额估算完成'}`;
    $('result').hidden = false;
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    clearResult('正在测算…');
    const data = new FormData(form);
    const read = name => {
      const value = data.get(name);
      return value === null || value === '' ? undefined : Number(value);
    };
    const options = {
      paidMonths: read('paidYears') * 12 + read('paidExtra'),
      averageIndex: read('averageIndex'), balance: read('balance'),
      pensionBase: read('pensionBase'), divisor: read('divisor'),
      transitional: read('transitional'), referenceYear: read('referenceYear'),
    };
    try {
      const result = mode() === 'forecast' ? forecastPension({
        ...options, pastIndex: options.averageIndex, asOf: data.get('asOf'), retirement: data.get('retirement'),
        futureMonths: read('futureMonths'), futureIndex: read('futureIndex'), contributionBase: read('contributionBase'),
        pensionGrowth: read('pensionGrowth'), contributionGrowth: read('contributionGrowth'), accountInterest: read('accountInterest'),
      }) : calculatePension({ ...options, retirementYear: read('retirementYear') });
      showResult(result);
    } catch (error) {
      $('status').textContent = '调整输入后重新计算。';
      $('error').textContent = error.message;
      $('error').hidden = false;
    }
  });

  form.addEventListener('invalid', event => {
    const details = event.target.closest('details');
    if (details) details.open = true;
  }, true);

  function onEdit(event) {
    if (event.target === $('age')) {
      if ($('age').value) $('divisor').value = $('age').value;
    } else if (event.target === $('divisor')) $('age').value = '';
    if (event.target.name === 'mode') syncMode();
    example = false;
    clearResult('参数已更新，点击「计算养老金」查看结果。');
  }
  form.addEventListener('input', onEdit);

  $('example').addEventListener('click', () => {
    const forecast = mode() === 'forecast';
    const sample = forecast
      ? { asOf: '2026-10', retirement: '2036-10', paidYears: 15, paidExtra: 6, averageIndex: 0.8,
        balance: 60_000, pensionBase: 8_000, contributionBase: 9_600, futureIndex: 1.2, futureMonths: '' }
      : { retirementYear: 2026, paidYears: 25, paidExtra: 6, averageIndex: 1, balance: 139_000, pensionBase: 8_000 };
    const fields = $(forecast ? 'forecast' : 'direct');
    for (const [name, value] of Object.entries(sample)) fields.querySelector(`[name="${name}"]`).value = value;
    form.elements.pensionGrowth.value = 0;
    form.elements.contributionGrowth.value = 0;
    form.elements.accountInterest.value = 0;
    form.elements.transitional.value = '';
    form.elements.referenceYear.value = '';
    $('divisor').value = $('age').value = forecast ? '117' : '139';
    example = true;
    form.requestSubmit();
  });

  $('clear').addEventListener('click', () => {
    const previousMode = mode();
    form.reset();
    form.elements.mode.value = previousMode;
    $('as-of').value = lastMonth();
    example = false;
    syncMode();
    clearResult('数据已清空。填写参数或载入示例开始测算。');
  });

  if (!$('as-of').value) $('as-of').value = lastMonth();
  syncMode();
  $('calculate').disabled = false;
}
