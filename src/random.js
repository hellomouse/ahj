// super random things
// todo: maybe use cryptographically secure stuff instead of Math.random()?
// const crypto = require('crypto');

/**
 * Generate a random decimal value between lower and upper
 * @param {number} lower Lower bound
 * @param {number} upper Upper bound
 * @return {number}
 */
function double(lower, upper) {
  return Math.random() * (upper - lower) + lower;
}
/**
 * Generate a random integer between lower and upper bounds
 * @param {number} lower Lower bound
 * @param {number} upper Upper bound
 * @return {number}
 */
function int(lower, upper) {
  return Math.floor(double(lower, upper));
}

/**
 * Pick a random element from an array
 * @param {any[]} arr List of things to choose from
 * @return {any}
 */
function fromList(arr) {
  return arr[int(0, arr.length)];
}

/**
 * Choose n elements from an array
 * @param {any[]} arr List of things to choose from
 * @param {number} n How many elements to choose
 * @return {any[]}
 */
function choose(arr, n) {
  if (n >= arr.length) return arr;
  let out = [];
  for (let i = 0; i < n; i++) {
    let i = int(0, arr.length);
    out.push(arr[i]);
    arr = arr.splice(i, 1);
  }
  return out;
}

/**
 * Get a random sample from a normal distribution
 * @param {number} m Mean
 * @param {number} s Standard deviation
 * @return {number}
 */
function normal(m, s) {
  let x1 = Math.random();
  let x2 = Math.random();
  return m + s * Math.sqrt(-2 * Math.log(x1)) * Math.cos(2 * Math.PI * x2);
}

/**
 * Get a random sample from a log-normal distribution
 * @param {number} m Mean
 * @param {number} s Standard deviation
 * @return {number}
 */
function logNormal(m, s) {
  return Math.exp(normal(Math.log(m) + s ** 2, Math.log(1 + s ** 2 / m ** 2)));
}

module.exports = {
  double,
  int,
  fromList,
  choose,
  normal,
  logNormal
};
