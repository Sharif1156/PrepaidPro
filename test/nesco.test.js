import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractCsrfToken,
  cookieHeaderFrom,
  parseNescoPanel,
  parseNescoMonthly,
  validateCustomerNo,
} from '../src/nesco.js';

const PANEL_HTML = `
<html><body>
<form>
  <input type="hidden" name="_token" value="abc123token">
  <input name="cust_no" type="text">
  <button type="submit" name="submit" value="recharge">রিচার্জ হিস্ট্রি</button>
</form>
<div id="con_info_div">
  <input value="Karim Mia" readonly>
  <input value="Abdul Mia" readonly>
  <input value="Village: Sherpur, Bogura" readonly>
  <input value="01700000000" readonly>
  <input value="Bogura S&D" readonly>
  <input value="Feeder 4" readonly>
  <input value="2456109837" readonly>
  <input value="346990702277" readonly>
  <input value="3 kW" readonly>
  <input value="LT-A" readonly>
  <input value="Three Phase" readonly>
  <input value="Active" readonly>
  <input value="12/03/2021" readonly>
  <input value="50" readonly>
  <input value="1,482.35" readonly>
</div>
<table>
  <tr data-order="ORD-1" data-token="1234567890" data-seq="1" data-rent="60"
      data-demandcharge="40" data-tax="75" data-pfc="0" data-subsidyamount="0"
      data-purchaseamount="1800" data-totalamount="2000" data-purchaseenergy="240"
      data-salename="bKash" data-purchasedate="01/10/2026" data-debtamount="0"
      data-paidamount="2000" data-meterno="346990702277" data-customerno="2456109837"
      data-customername="Karim Mia" data-tariff="LT-A" data-organization="NESCO">
    <td>ORD-1</td><td>1234567890</td><td>2,000</td><td>Success</td>
  </tr>
  <tr data-order="ORD-2" data-token="9876543210" data-seq="2" data-rent="60"
      data-demandcharge="40" data-tax="60" data-pfc="0" data-subsidyamount="0"
      data-purchaseamount="1400" data-totalamount="1000" data-purchaseenergy="190"
      data-salename="Nagad" data-purchasedate="15/09/2026" data-debtamount="0"
      data-paidamount="1000" data-meterno="346990702277" data-customerno="2456109837"
      data-customername="Karim Mia" data-tariff="LT-A" data-organization="NESCO">
    <td>ORD-2</td><td>9876543210</td><td>1,000</td><td>Success</td>
  </tr>
</table>
<p>Last reading 20 October 2026</p>
</body></html>`;

const MONTHLY_HTML = `
<html><body>
<table>
  <thead>
    <tr><th>মাস</th><th>বছর</th><th>কি.ও.আ (ইউনিট)</th><th>টাকা</th></tr>
  </thead>
  <tbody>
    <tr><td>সেপ্টেম্বর</td><td>2026</td><td>280</td><td>2,100</td></tr>
    <tr><td>অক্টোবর</td><td>2026</td><td>120</td><td>900</td></tr>
  </tbody>
</table>
</body></html>`;

test('CSRF tokens are found in both attribute orders and meta tags', () => {
  assert.equal(extractCsrfToken('<input name="_token" value="one">'), 'one');
  assert.equal(extractCsrfToken('<input value="two" name="_token">'), 'two');
  assert.equal(extractCsrfToken('<meta name="csrf-token" content="three">'), 'three');
  assert.equal(extractCsrfToken('<html></html>'), null);
});

test('cookies are flattened into a request header', () => {
  const header = cookieHeaderFrom(['XSRF-TOKEN=abc; Path=/; HttpOnly', 'nesco_session=xyz; Path=/']);
  assert.equal(header, 'XSRF-TOKEN=abc; nesco_session=xyz');
  assert.equal(cookieHeaderFrom([]), '');
  assert.equal(cookieHeaderFrom(undefined), '');
});

test('customer numbers are validated', () => {
  assert.equal(validateCustomerNo(' 245 - 610 9837 '), '2456109837');
  assert.throws(() => validateCustomerNo('12'), (error) => error.code === 'BAD_REQUEST');
});

test('the panel parser extracts customer info and recharge rows', () => {
  const { info, history } = parseNescoPanel(PANEL_HTML);
  assert.equal(info.name, 'Karim Mia');
  assert.equal(info.consumerNo, '2456109837');
  assert.equal(info.meterNo, '346990702277');
  assert.equal(info.balance, '1,482.35');
  assert.equal(info.tariff, 'LT-A');
  assert.equal(info.meterStatus, 'Active');
  assert.equal(info.readingDate, '20 October 2026');

  assert.equal(history.length, 2);
  assert.equal(history[0].order, 'ORD-1');
  assert.equal(history[0].rechargeAmount, 2000);
  assert.equal(history[0].energyUnit, 240);
  assert.equal(history[0].rechargeStatus, 'Success');
  assert.equal(history[1].method, 'Nagad');
});

test('the panel parser survives an empty or unexpected page', () => {
  const empty = parseNescoPanel('<html><body>nothing</body></html>');
  assert.deepEqual(empty.history, []);
  assert.equal(empty.info.balance, undefined);
});

test('the monthly usage parser reads Bengali headers and rows', () => {
  const rows = parseNescoMonthly(MONTHLY_HTML);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { month: '2026-09', unit: 280, taka: 2100, demand: null });
  assert.deepEqual(rows[1], { month: '2026-10', unit: 120, taka: 900, demand: null });
});

test('the monthly parser degrades gracefully', () => {
  assert.deepEqual(parseNescoMonthly(''), []);
  assert.deepEqual(parseNescoMonthly('<table><tr><td>no rows</td></tr></table>'), []);
});
