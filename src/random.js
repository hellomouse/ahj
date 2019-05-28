// super random things
// todo: maybe use cryptographically secure stuff instead of Math.random()?
// const crypto = require('crypto');

/**
 * Generate a random decimal value between lower and upper
 * @param {Number} lower Lower bound
 * @param {Number} upper Upper bound
 * @return {Number}
 */
function double(lower, upper) {
  return Math.random() * (upper - lower) + lower;
}
/**
 * Generate a random integer between lower and upper bounds
 * @param {Number} lower Lower bound
 * @param {Number} upper Upper bound
 * @return {Number}
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
 * @param {Number} n How many elements to choose
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

module.exports = {
  double,
  int,
  fromList,
  choose
};
